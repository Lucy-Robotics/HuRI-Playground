export function chosenRows(rows, chosen) {
  return rows.filter((row) => chosen.has(row.name));
}

export function producedTopics(chosenList) {
  return new Set(chosenList.flatMap((row) => row.outputs));
}

export function unfedInputs(row, chosenList, inbound) {
  const others = chosenList.filter((other) => other.name !== row.name);
  return row.inputs.filter(
    (topic) => !inbound.includes(topic) && !others.some((o) => o.outputs.includes(topic)),
  );
}

export function isFed(row, chosenList, inbound) {
  return unfedInputs(row, chosenList, inbound).length === 0;
}

export function firstUnfedInput(rows, chosen, inbound) {
  const chosenList = chosenRows(rows, chosen);
  for (const row of chosenList) {
    const [topic] = unfedInputs(row, chosenList, inbound);
    if (topic !== undefined) return { row, topic };
  }
  return null;
}

export function feedersOf(topic, rows) {
  return rows.filter((row) => row.outputs.includes(topic) && !row.inputs.includes(topic));
}

export function needsText(topic, rows) {
  const feeders = feedersOf(topic, rows);
  if (feeders.length === 0) return `"${topic}", which no module here produces`;
  return feeders.map((row) => row.label).join(" or ");
}

export function withRow(rows, chosen, inbound, name) {
  const next = new Set(chosen);
  const row = rows.find((r) => r.name === name);
  if (!row || next.has(name)) return next;
  next.add(name);
  for (const topic of unfedInputs(row, chosenRows(rows, next), inbound)) {
    const feeders = feedersOf(topic, rows);
    if (feeders.length === 1) {
      for (const added of withRow(rows, next, inbound, feeders[0].name)) next.add(added);
    }
  }
  return next;
}

export function withoutRow(rows, chosen, inbound, name) {
  const before = chosenRows(rows, chosen);
  const wasFed = before.filter((row) => isFed(row, before, inbound));
  const next = new Set(chosen);
  next.delete(name);
  let changed = true;
  while (changed) {
    changed = false;
    const now = chosenRows(rows, next);
    for (const row of wasFed) {
      if (next.has(row.name) && !isFed(row, now, inbound)) {
        next.delete(row.name);
        changed = true;
      }
    }
  }
  return next;
}

// Whether what the page sends on `topic` leads to something it shows.
function shows(topic, chosenList, rendered, seen = new Set()) {
  if (seen.has(topic)) return false;
  seen.add(topic);
  return chosenList
    .filter((row) => row.inputs.includes(topic))
    .flatMap((row) => row.outputs)
    .some((out) => rendered.includes(out) || shows(out, chosenList, rendered, seen));
}

export function checkSelection(rows, chosen, inbound, rendered) {
  const chosenList = chosenRows(rows, chosen);
  if (chosenList.length === 0) return { problem: "Pick at least one module." };
  const unfed = firstUnfedInput(rows, chosen, inbound);
  if (unfed) {
    return { problem: `${unfed.row.label} needs ${needsText(unfed.topic, rows)}.` };
  }
  const sends = inbound.filter((t) => chosenList.some((row) => row.inputs.includes(t)));
  if (sends.length === 0) {
    return { problem: "Nothing you can type or say reaches these modules." };
  }
  const produced = producedTopics(chosenList);
  const gets = rendered.filter((t) => produced.has(t));
  if (gets.length === 0) {
    return { problem: "These modules produce nothing this page can show." };
  }
  // Valid, but e.g. emotion with no question builder goes nowhere visible.
  const silent = sends.filter((t) => !shows(t, chosenList, rendered));
  return { sends: sends.filter((t) => !silent.includes(t)), gets, silent };
}

export function listOf(words, joiner) {
  if (words.length < 2) return words.join("");
  return `${words.slice(0, -1).join(", ")} ${joiner} ${words[words.length - 1]}`;
}

export function optionHint(rows, moduleName, spec) {
  const names = [moduleName, spec.needs, ...(spec.ticks || [])].filter(Boolean);
  // Names HuRI doesn't run have no row: leave them out rather than show a raw module name.
  const labels = [...new Set(names)].flatMap((n) => rows.find((r) => r.name === n)?.label ?? []);
  return `Picking one also ticks ${listOf(labels, "and")}.`;
}
