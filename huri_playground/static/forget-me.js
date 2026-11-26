import { forgetVisitorId, peekVisitorId } from "./visitor-id.js";

export const MEMORY_TEXT = {
  remembered: "This browser holds your HuRI id. Tick the box to use it.",
  confirming:
    "HuRI will treat you as a new visitor on this browser. What it already remembers about you is not deleted.",
  done: "Done. This browser now starts fresh. What HuRI already stored is not deleted.",
  noStorage:
    "This browser does not let HuRI remember you, so every conversation starts fresh.",
  forget: "Forget me",
  confirm: "Yes, forget me",
  cancel: "Cancel",
};

export function mountForgetMe(root, storage) {
  const doc = root.ownerDocument;
  const text = doc.createElement("span");
  text.id = "memory-text";
  text.className = "muted small";
  text.tabIndex = -1;
  const forget = button(doc, "forget", MEMORY_TEXT.forget);
  const confirm = button(doc, "forget-confirm", MEMORY_TEXT.confirm);
  const cancel = button(doc, "forget-cancel", MEMORY_TEXT.cancel);
  let disabled = false;

  function show(message, buttons, focused) {
    root.hidden = false;
    text.textContent = message;
    root.replaceChildren(text, ...buttons);
    for (const b of [forget, confirm, cancel]) b.disabled = disabled;
    if (focused) focused.focus();
  }

  function showRemembered(message, focused) {
    show(message, [forget], focused);
  }

  function showConfirming() {
    show(MEMORY_TEXT.confirming, [confirm, cancel], cancel);
  }

  function forgetNow() {
    if (!forgetVisitorId(storage)) return showNoStorage();
    show(MEMORY_TEXT.done, [], text);
  }

  function showNoStorage() {
    show(MEMORY_TEXT.noStorage, [], null);
  }

  forget.addEventListener("click", showConfirming);
  confirm.addEventListener("click", forgetNow);
  cancel.addEventListener("click", () => showRemembered(MEMORY_TEXT.remembered, forget));
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !cancel.disabled && cancel.isConnected) cancel.click();
  });

  const memory = peekVisitorId(storage);
  if (memory === "unavailable") showNoStorage();
  else if (memory === "none") root.hidden = true;
  else showRemembered(MEMORY_TEXT.remembered, null);

  return {
    showUnavailable: showNoStorage,
    setDisabled(value) {
      disabled = value;
      for (const b of [forget, confirm, cancel]) b.disabled = value;
    },
  };
}

function button(doc, id, label) {
  const el = doc.createElement("button");
  el.id = id;
  el.type = "button";
  el.textContent = label;
  return el;
}
