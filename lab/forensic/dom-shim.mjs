// Small DOM stand-in for the trailer methods and youtube-proxy.html.
// It is not a browser and cannot prove a composited TV frame.

function createClassList(element) {
  const names = new Set();
  return {
    add(...values) {
      values.flat().forEach((value) => {
        if (value) names.add(String(value));
      });
      element._className = [...names].join(" ");
    },
    remove(...values) {
      values.flat().forEach((value) => names.delete(String(value)));
      element._className = [...names].join(" ");
    },
    contains(value) {
      return names.has(String(value));
    },
    toggle(value, force) {
      const has = names.has(String(value));
      const next = force == null ? !has : Boolean(force);
      if (next) names.add(String(value));
      else names.delete(String(value));
      element._className = [...names].join(" ");
      return next;
    }
  };
}

export function createElement(tagName, owner) {
  const element = {
    tagName: String(tagName || "div").toUpperCase(),
    owner,
    id: "",
    className: "",
    _className: "",
    src: "",
    title: "",
    allow: "",
    referrerPolicy: "",
    allowFullscreen: false,
    children: [],
    parentElement: null,
    style: {},
    attributes: new Map(),
    listeners: new Map(),
    contentWindow: null,
    _connected: false
  };
  element.classList = createClassList(element);
  Object.defineProperty(element, "className", {
    get() {
      return element._className;
    },
    set(value) {
      element._className = String(value || "");
      element.classList = createClassList(element);
      element._className
        .split(/\s+/)
        .filter(Boolean)
        .forEach((name) => element.classList.add(name));
    }
  });
  Object.defineProperty(element, "isConnected", {
    get() {
      return element._connected;
    }
  });
  Object.defineProperty(element, "firstElementChild", {
    get() {
      return element.children[0] || null;
    }
  });
  element.setAttribute = (name, value) => {
    element.attributes.set(String(name), String(value));
    if (name === "id") element.id = String(value);
    if (name === "src") element.src = String(value);
    if (name === "class") element.className = String(value);
  };
  element.getAttribute = (name) => element.attributes.get(String(name)) ?? null;
  element.removeAttribute = (name) => {
    element.attributes.delete(String(name));
    if (name === "src") element.src = "";
  };
  element.addEventListener = (type, fn, options) => {
    const list = element.listeners.get(type) || [];
    list.push({ fn, once: Boolean(options?.once) });
    element.listeners.set(type, list);
  };
  element.removeEventListener = (type, fn) => {
    const list = element.listeners.get(type) || [];
    element.listeners.set(
      type,
      list.filter((entry) => entry.fn !== fn)
    );
  };
  element.dispatchEvent = (event) => {
    const list = [...(element.listeners.get(event?.type) || [])];
    list.forEach((entry) => {
      if (entry.once) {
        element.removeEventListener(event.type, entry.fn);
      }
      entry.fn(event);
    });
    return true;
  };
  element.appendChild = (child) => {
    child.parentElement = element;
    child._connected = true;
    element.children.push(child);
    if (child.tagName === "SCRIPT" && typeof owner.onScript === "function") {
      owner.onScript(child);
    }
    return child;
  };
  element.removeChild = (child) => {
    element.children = element.children.filter((entry) => entry !== child);
    child.parentElement = null;
    child._connected = false;
    return child;
  };
  element.querySelector = (selector) => {
    const wanted = String(selector || "")
      .replace(/^\./, "")
      .toLowerCase();
    const walk = (node) => {
      for (const child of node.children || []) {
        if (
          child.tagName.toLowerCase() === wanted ||
          child.classList.contains(wanted) ||
          child.id === wanted
        ) {
          return child;
        }
        const nested = walk(child);
        if (nested) return nested;
      }
      return null;
    };
    return walk(element);
  };
  element.querySelectorAll = (selector) => {
    const found = [];
    const wanted = String(selector || "").toLowerCase();
    const walk = (node) => {
      for (const child of node.children || []) {
        if (
          wanted.includes(child.tagName.toLowerCase()) ||
          child.classList.contains(wanted.replace(/^\./, ""))
        ) {
          found.push(child);
        }
        walk(child);
      }
    };
    walk(element);
    return found;
  };
  Object.defineProperty(element, "innerHTML", {
    get() {
      return element._html || "";
    },
    set(value) {
      element.children.forEach((child) => {
        child._connected = false;
        child.parentElement = null;
      });
      element.children = [];
      element._html = String(value || "");
      const match = element._html.match(/<iframe\b([^>]*)>/i);
      if (match && owner) {
        const frame = owner.createElement("iframe");
        const id = match[1].match(/\bid="([^"]+)"/i);
        const src = match[1].match(/\bsrc="([^"]+)"/i);
        if (id) frame.id = id[1];
        if (src) frame.src = src[1].replace(/&amp;/g, "&");
        element.appendChild(frame);
      }
    }
  });
  if (element.tagName === "IFRAME") {
    element.contentWindow = {
      postMessage(payload) {
        element.posted = element.posted || [];
        element.posted.push(payload);
      },
      frame: element
    };
  }
  return element;
}

export function createDocument() {
  const owner = {
    scripts: [],
    onScript: null,
    createElement(tagName) {
      return createElement(tagName, owner);
    }
  };
  const document = {
    owner,
    createElement: (tagName) => owner.createElement(tagName),
    getElementById(id) {
      const walk = (node) => {
        if (!node) return null;
        if (node.id === id) return node;
        for (const child of node.children || []) {
          const found = walk(child);
          if (found) return found;
        }
        return null;
      };
      return walk(document.body) || walk(document.head);
    },
    head: null,
    body: null
  };
  document.head = createElement("head", owner);
  document.body = createElement("body", owner);
  document.documentElement = createElement("html", owner);
  document.documentElement.appendChild(document.head);
  document.documentElement.appendChild(document.body);
  return document;
}

export function createWindow(document) {
  const listeners = new Map();
  const window = {
    document,
    listeners,
    addEventListener(type, fn) {
      const list = listeners.get(type) || [];
      list.push(fn);
      listeners.set(type, list);
    },
    removeEventListener(type, fn) {
      const list = listeners.get(type) || [];
      listeners.set(
        type,
        list.filter((entry) => entry !== fn)
      );
    },
    dispatchMessage(event) {
      const list = [...(listeners.get("message") || [])];
      list.forEach((fn) => fn(event));
    },
    listenerCount(type) {
      return (listeners.get(type) || []).length;
    }
  };
  return window;
}
