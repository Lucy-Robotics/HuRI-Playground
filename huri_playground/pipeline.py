"""Turn the modules a visitor ticked into a HuRI session.

HuRI wires a session by topic: each module consumes one topic and may emit
one, and a module whose topic never arrives just sits there. The browser can
publish only a few topics (typed questions, microphone frames) and render only
a few, so a selection is accepted when every module's input comes either from
the browser or from another selected module, the browser can reach at least
one of them, and something they produce shows up on the page.
"""

from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping, Set, Tuple

from .files import load_mapping
from .interrupts import session_interrupts, takes_interrupts

MODULES_PATH = Path(__file__).parent / "modules.yaml"

# modules.yaml's `selected: all`: every module is ticked when the page opens.
ALL = "all"

# Where a module goes when modules.yaml gives it no group.
OTHER_GROUP = "other"

JSON_FRAME = "json"
BINARY_FRAME = "binary"

ROW_ONLY_KEYS = ("group", "label", "description", "options", "swaps")

# Topics static/app.js knows how to show or play, in the order the page lists
# them, with their frame kind on the wire (huri-core's client SDK sends a JSON
# event as a text frame and a bytes event as a binary frame). HuRI refuses a
# subscription to a topic no module of the session emits, so only the produced
# ones are subscribed to.
RENDERED: Dict[str, str] = {
    "huri.token": JSON_FRAME,
    "huri.audio.out": BINARY_FRAME,
    "huri.motion": BINARY_FRAME,
    # huri-module-lips-sync: ARKit weights for the avatar's mouth.
    "huri.lips.face": BINARY_FRAME,
    # VAD frames {"data": [floats]} while the visitor speaks, {"data": null} at the end.
    "huri.voice": JSON_FRAME,
    "huri.transcript": JSON_FRAME,
    "huri.question": JSON_FRAME,
    "huri.emotion": JSON_FRAME,
    "huri.emotion.out": JSON_FRAME,
}


class InvalidPipeline(ValueError):
    pass


@dataclass(frozen=True)
class InboundRule:
    """Limits on one topic the browser is allowed to publish."""

    max_per_minute: int
    max_chars: int | None = None
    # Binary frames ([u16 topic_len][topic][payload]) instead of JSON.
    binary: bool = False


@dataclass(frozen=True)
class Option:
    """One arg a visitor may set, to one of a few values listed in modules.yaml."""

    label: str
    default: str
    # Value -> how the page describes it.
    values: Mapping[str, str]
    # Only offered, and only set, when this module is in the pipeline too.
    needs: str | None = None
    # Modules the page ticks when a value is picked, so it applies at once.
    ticks: List[str] = field(default_factory=list)

    def public(self) -> Dict[str, Any]:
        return {
            "label": self.label,
            "default": self.default,
            "values": [{"value": v, "label": text} for v, text in self.values.items()],
            "needs": self.needs,
            "ticks": self.ticks,
        }


@dataclass(frozen=True)
class ModuleInfo:
    """A module HuRI runs, with what the playground adds to it."""

    name: str
    input: str
    output: str | None
    label: str
    description: str
    group: str
    args: Mapping[str, Any]
    # Other module -> args added when both are in the pipeline.
    with_args: Mapping[str, Mapping[str, Any]]
    options: Mapping[str, Option] = field(default_factory=dict)

    def args_with(self, selected: Iterable[str]) -> Dict[str, Any]:
        args = dict(self.args)
        for other, extra in self.with_args.items():
            if other in selected:
                args.update(extra)
        return args

    def has_topics_of(self, other: "ModuleInfo") -> bool:
        return (self.input, self.output) == (other.input, other.output)


@dataclass(frozen=True)
class ModuleRow:
    name: str
    label: str
    description: str
    group: str
    members: Tuple[ModuleInfo, ...]
    swaps: Mapping[str, ModuleInfo] = field(default_factory=dict)

    @property
    def inputs(self) -> List[str]:
        return list(dict.fromkeys(m.input for m in self.members))

    @property
    def outputs(self) -> List[str]:
        produced = (m.output for m in self.members if m.output is not None)
        return list(dict.fromkeys(produced))

    @property
    def options(self) -> Dict[str, Option]:
        return {name: o for m in self.members for name, o in m.options.items()}

    def public(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "label": self.label,
            "description": self.description,
            "group": self.group,
            "inputs": self.inputs,
            "outputs": self.outputs,
            "options": {name: o.public() for name, o in self.options.items()},
        }


@dataclass(frozen=True)
class Pipeline:
    """A checked selection: what to ask HuRI for and what may cross the gateway."""

    modules: Mapping[str, Any]
    inbound: Mapping[str, InboundRule]
    # Topics HuRI streams back, in RENDERED's order.
    outbound: List[str]
    # Module -> option -> value, for the options this pipeline offers.
    options: Mapping[str, Mapping[str, str]] = field(default_factory=dict)
    interrupts: Mapping[str, List[str]] = field(default_factory=dict)

    def handshake(self, user_id: str) -> Dict[str, Any]:
        """The session HuRI expects as the first message on ``/session``: the
        ``ClientConfig`` of huri-core (``user_id``, ``modules``, the topics the
        client ``send``s and those it ``subscribe``s to)."""
        handshake: Dict[str, Any] = {
            "user_id": user_id,
            "modules": dict(self.modules),
            "send": list(self.inbound),
            "subscribe": list(self.outbound),
        }
        if self.interrupts:
            handshake["event_policy"] = {"interrupts": dict(self.interrupts)}
        return handshake

    def without_interrupts(self) -> "Pipeline":
        return replace(self, interrupts={})


class Catalog:
    """The modules a visitor can pick from right now."""

    def __init__(
        self,
        rows: Iterable[ModuleRow],
        inbound: Mapping[str, InboundRule],
        selected: Iterable[str] | str,
        groups: Mapping[str, str] | None = None,
        interrupts: Mapping[str, List[str]] | None = None,
    ):
        self.rows = {row.name: row for row in rows}
        self.inbound = dict(inbound)
        # "all": every module this HuRI runs.
        names = list(self.rows) if selected == ALL else selected
        self.selected = [name for name in names if name in self.rows]
        self.groups = dict(groups or {})
        self.interrupts = dict(interrupts or {})

    def public(self) -> Dict[str, Any]:
        used = {row.group for row in self.rows.values()}
        groups = {**self.groups, OTHER_GROUP: "Other"}
        return {
            "groups": [
                {"id": g, "label": label} for g, label in groups.items() if g in used
            ],
            "modules": [row.public() for row in self.rows.values()],
            "inbound": list(self.inbound),
            "rendered": list(RENDERED),
            "selected": self.selected,
        }

    def build(
        self,
        names: Any,
        picked: Any = None,
        extra: Mapping[str, Mapping[str, Any]] | None = None,
    ) -> Pipeline:
        """``picked``: the visitor's option values, ``{module: {option: value}}``;
        ``extra``: args the gateway adds to the modules picked, such as the
        avatar's body (see avatars.py)."""
        rows = self._rows_named(names)
        self._check_fed(rows)
        chosen = _modules_of(rows)
        produced = {m.output for m in chosen if m.output is not None}
        consumed = {m.input for m in chosen}
        inbound = {t: rule for t, rule in self.inbound.items() if t in consumed}
        if not inbound:
            raise InvalidPipeline("nothing you can type or say reaches these modules")
        outbound = [t for t in RENDERED if t in produced]
        if not outbound:
            raise InvalidPipeline("these modules produce nothing the page can show")

        options = self._options(chosen, {m.name for m in chosen}, picked)
        return Pipeline(
            modules=_module_configs(chosen, options, extra or {}),
            inbound=inbound,
            outbound=outbound,
            options=options,
            interrupts=session_interrupts(
                self.interrupts, {*inbound, *produced}, produced
            ),
        )

    def _rows_named(self, names: Any) -> List[ModuleRow]:
        if (
            not isinstance(names, list)
            or not names
            or not all(isinstance(n, str) for n in names)
        ):
            raise InvalidPipeline("pick at least one module")
        unknown = sorted(set(names) - set(self.rows))
        if unknown:
            raise InvalidPipeline(f"unknown module(s): {', '.join(unknown)}")
        return [self.rows[n] for n in dict.fromkeys(names)]

    def _check_fed(self, rows: List[ModuleRow]) -> None:
        for row in rows:
            fed = {t for other in rows if other is not row for t in other.outputs}
            for topic in row.inputs:
                if topic not in fed and topic not in self.inbound:
                    raise InvalidPipeline(
                        f"{row.name} needs {topic!r}, which no selected module produces"
                    )

    @staticmethod
    def _options(
        chosen: List[ModuleInfo], selected: set, picked: Any
    ) -> Dict[str, Dict[str, str]]:
        picked = picked if picked is not None else {}
        if not isinstance(picked, dict) or not all(
            isinstance(v, dict) for v in picked.values()
        ):
            raise InvalidPipeline("options must map modules to {option: value}")
        offered = {m.name: m.options for m in chosen if m.options}
        for name, values in picked.items():
            for option, value in values.items():
                spec = offered.get(name, {}).get(option)
                if spec is None:
                    raise InvalidPipeline(f"{name} has no option {option!r} here")
                if not isinstance(value, str) or value not in spec.values:
                    raise InvalidPipeline(f"{name}.{option} cannot be {value!r}")

        result: Dict[str, Dict[str, str]] = {}
        for name, specs in offered.items():
            for option, spec in specs.items():
                if spec.needs is not None and spec.needs not in selected:
                    continue
                value = picked.get(name, {}).get(option, spec.default)
                result.setdefault(name, {})[option] = value
        return result


def _module_configs(
    chosen: List[ModuleInfo],
    options: Mapping[str, Mapping[str, str]],
    extra: Mapping[str, Mapping[str, Any]],
) -> Dict[str, Dict[str, Any]]:
    selected = {m.name for m in chosen}
    return {
        m.name: {
            "name": m.name,
            "args": {
                **m.args_with(selected),
                **options.get(m.name, {}),
                **extra.get(m.name, {}),
            },
        }
        for m in chosen
    }


def _modules_of(rows: List[ModuleRow]) -> List[ModuleInfo]:
    swaps = {name: m for row in rows for name, m in row.swaps.items()}
    return [swaps.get(m.name, m) for row in rows for m in row.members]


@dataclass(frozen=True)
class CatalogConfig:
    """modules.yaml: how to present and configure the modules HuRI reports."""

    inbound: Mapping[str, InboundRule]
    selected: List[str] | str  # or ALL
    entries: Mapping[str, Mapping[str, Any]]
    groups: Mapping[str, str] = field(default_factory=dict)
    rows: Mapping[str, Mapping[str, Any]] = field(default_factory=dict)
    interrupts: Mapping[str, List[str]] = field(default_factory=dict)
    without_visitor: Mapping[str, Mapping[str, Any]] = field(default_factory=dict)

    def catalog(
        self,
        details: Mapping[str, Mapping[str, Any]],
        allowed: Iterable[str] | None = None,
        core_version: Any = None,
    ) -> Catalog:
        """Combine HuRI's ``GET /modules`` with this file.

        ``details`` is that answer's ``details`` key: each enabled module's
        ``input`` and ``output`` topics (``output`` is null for a terminal
        module). ``allowed`` narrows what visitors see (``PLAYGROUND_MODULES``).
        Modules come in this file's order, which follows the flow from
        microphone to answer; ones it does not list go last.
        """
        known = self._known_modules(details, allowed)
        interrupts = self.interrupts if takes_interrupts(core_version) else {}
        rows = self._rows(known)
        return Catalog(rows, self.inbound, self.selected, self.groups, interrupts)

    def _known_modules(
        self,
        details: Mapping[str, Mapping[str, Any]],
        allowed: Iterable[str] | None,
    ) -> Dict[str, ModuleInfo]:
        allowed = set(allowed) if allowed is not None else None
        order = {name: i for i, name in enumerate(self.entries)}
        return {
            name: self._module_info(name, details[name])
            for name in sorted(details, key=lambda n: order.get(n, len(order)))
            if allowed is None or name in allowed
        }

    def _module_info(self, name: str, item: Mapping[str, Any]) -> ModuleInfo:
        entry = self.entries.get(name, {})
        return ModuleInfo(
            name=name,
            input=item["input"],
            output=item.get("output"),
            label=entry.get("label", name),
            description=entry.get("description", ""),
            group=entry.get("group") or OTHER_GROUP,
            args=entry.get("args") or {},
            with_args=entry.get("with") or {},
            options={
                option: Option(**spec)
                for option, spec in (entry.get("options") or {}).items()
            },
        )

    def _rows(self, known: Mapping[str, ModuleInfo]) -> List[ModuleRow]:
        hidden = self.bundled_modules() | self._swap_targets_offered_for(known)
        bundles = [self._bundle_row(name, known) for name in self.rows]
        plain = [
            self._row(name, (m,), known)
            for name, m in known.items()
            if name not in hidden
        ]
        rows = [row for row in [*bundles, *plain] if row is not None]
        place = {name: i for i, name in enumerate(known)}
        return sorted(rows, key=lambda row: min(place[m.name] for m in row.members))

    def _bundle_row(
        self, name: str, known: Mapping[str, ModuleInfo]
    ) -> ModuleRow | None:
        entry = self.rows[name]
        members = tuple(known[m] for m in entry["members"] if m in known)
        has_output = any(m.output is not None for m in members)
        has_required = all(m in known for m in entry.get("required") or [])
        return self._row(name, members, known) if has_output and has_required else None

    def _row(
        self,
        name: str,
        members: Tuple[ModuleInfo, ...],
        known: Mapping[str, ModuleInfo],
    ) -> ModuleRow:
        entry = self.rows.get(name) or self.entries.get(name) or {}
        return ModuleRow(
            name=name,
            label=entry.get("label", name),
            description=entry.get("description", ""),
            group=entry.get("group") or OTHER_GROUP,
            members=members,
            swaps=_kept_swaps(entry.get("swaps") or {}, known),
        )

    def hidden_modules(self) -> Set[str]:
        return self.bundled_modules() | self.swap_targets()

    def bundled_modules(self) -> Set[str]:
        return {m for row in self.rows.values() for m in row["members"]}

    def _swap_targets_offered_for(self, known: Mapping[str, ModuleInfo]) -> Set[str]:
        return {
            new
            for _, swaps in _swap_entries(self)
            for old, new in swaps.items()
            if old in known
        }

    def swap_targets(self) -> Set[str]:
        return {target for _, swaps in _swap_entries(self) for target in swaps.values()}


def _kept_swaps(
    swaps: Mapping[str, str], known: Mapping[str, ModuleInfo]
) -> Dict[str, ModuleInfo]:
    return {
        old: known[new]
        for old, new in swaps.items()
        if old in known and new in known and known[old].has_topics_of(known[new])
    }


def _swap_entries(config: CatalogConfig) -> List[Tuple[str, Mapping[str, str]]]:
    entries = [(f"modules.{n}", e) for n, e in config.entries.items()]
    entries += [(f"rows.{n}", e) for n, e in config.rows.items()]
    return [(where, entry["swaps"]) for where, entry in entries if entry.get("swaps")]


def load_catalog_config(path: Path = MODULES_PATH) -> CatalogConfig:
    raw = load_mapping(path)
    try:
        return _checked_config(raw)
    except ValueError as e:
        raise ValueError(f"{path}: {e}") from None


def _checked_config(raw: Mapping[str, Any]) -> CatalogConfig:
    config = CatalogConfig(
        inbound={topic: InboundRule(**rule) for topic, rule in raw["inbound"].items()},
        selected=raw.get("selected") or [],
        entries=raw.get("modules") or {},
        groups=raw.get("groups") or {},
        rows=raw.get("rows") or {},
        interrupts=raw.get("interrupts") or {},
        without_visitor=raw.get("without_visitor") or {},
    )
    _check_rows(config)
    _check_swaps(config)
    _check_modules(config)
    _check_interrupts(config)
    _check_selected(config)
    _check_without_visitor(config)
    return config


def _check_group(
    where: str, entry: Mapping[str, Any], groups: Mapping[str, str]
) -> None:
    if entry.get("group") is not None and entry["group"] not in groups:
        raise ValueError(f"{where}.group {entry['group']!r} is not in groups")


def _check_modules(config: CatalogConfig) -> None:
    for name, entry in config.entries.items():
        _check_group(name, entry, config.groups)
        for other in entry.get("with") or {}:
            if other not in config.entries:
                raise ValueError(f"{name}.with names unknown module {other!r}")
        _check_options(name, entry.get("options") or {}, config)


def _check_options(
    name: str, options: Mapping[str, Any], config: CatalogConfig
) -> None:
    hidden = config.hidden_modules()
    for option, spec in options.items():
        if spec["default"] not in spec["values"]:
            raise ValueError(f"{name}.{option} default is not a value")
        for other in [spec.get("needs"), *spec.get("ticks", [])]:
            if other is not None and other not in config.entries:
                raise ValueError(f"{name}.{option} names unknown {other!r}")
            if other in hidden:
                raise ValueError(f"{name}.{option} names {other!r}, which is not a row")


def _check_rows(config: CatalogConfig) -> None:
    owner: Dict[str, str] = {}
    for name, row in config.rows.items():
        _check_row(name, row, config)
        for member in row["members"]:
            if member in owner:
                raise ValueError(f"{member} is in rows {owner[member]} and {name}")
            owner[member] = name


def _check_row(name: str, row: Mapping[str, Any], config: CatalogConfig) -> None:
    where = f"rows.{name}"
    if name in config.entries:
        raise ValueError(f"{where} has the name of a module")
    members = row.get("members")
    if not isinstance(members, list) or not members:
        raise ValueError(f"{where}.members must list modules")
    unknown = [m for m in members if m not in config.entries]
    if unknown:
        raise ValueError(f"{where}.members names unknown modules {unknown!r}")
    if not set(row.get("required") or []) <= set(members):
        raise ValueError(f"{where}.required must name its members")
    _check_group(where, row, config.groups)
    owned = [(m, k) for m in members for k in ROW_ONLY_KEYS if k in config.entries[m]]
    if owned:
        raise ValueError(f"{where}: member {owned[0][0]} has its own {owned[0][1]}")


def _check_swaps(config: CatalogConfig) -> None:
    entries = _swap_entries(config)
    malformed = [where for where, entry in entries if not isinstance(entry, dict)]
    if malformed:
        raise ValueError(f"{malformed[0]}.swaps must map modules to modules")
    swaps = [
        (where, old, new) for where, entry in entries for old, new in entry.items()
    ]
    swapped = {old for _, old, _ in swaps}
    bundled = config.bundled_modules()
    for where, old, new in swaps:
        if old not in config.entries or new not in config.entries:
            raise ValueError(f"{where}.swaps names unknown modules {old!r}, {new!r}")
        if new in bundled or new in swapped or config.entries[new].get("swaps"):
            raise ValueError(f"{where}.swaps: {new!r} cannot stand in for {old!r}")


def _check_interrupts(config: CatalogConfig) -> None:
    triggers = {t for t, rule in config.inbound.items() if not rule.binary}
    triggers |= {t for t, frame in RENDERED.items() if frame == JSON_FRAME}
    for trigger, targets in config.interrupts.items():
        if trigger not in triggers:
            raise ValueError(f"interrupts: {trigger!r} is not a JSON topic of the page")
        if not isinstance(targets, list) or not all(t in RENDERED for t in targets):
            raise ValueError(f"interrupts.{trigger} must list topics the page renders")


def _check_selected(config: CatalogConfig) -> None:
    if config.selected == ALL:
        return
    if not isinstance(config.selected, list):
        raise ValueError(f"selected must be a list of rows or {ALL!r}")
    unknown = [n for n in config.selected if n not in {**config.rows, **config.entries}]
    if unknown:
        raise ValueError(f"selected names unknown {unknown!r}")
    hidden = [n for n in config.selected if n in config.hidden_modules()]
    if hidden:
        raise ValueError(f"selected names {hidden[0]!r}, which is not a row")


def _check_without_visitor(config: CatalogConfig) -> None:
    if not isinstance(config.without_visitor, dict):
        raise ValueError("without_visitor must map modules to args")
    for name, args in config.without_visitor.items():
        if name not in config.entries:
            raise ValueError(f"without_visitor names unknown {name!r}")
        if not isinstance(args, dict):
            raise ValueError(f"without_visitor.{name} must map args")
