// By Kris Maglione. Public Domain.
// Please feel free to copy and use at will.

var ADDON_ID;

const OVERLAY_URLS = [
    "about:addons",
    "chrome://mozapps/content/extensions/extensions.xul"
];

let { interfaces: Ci, utils: Cu } = Components;

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");

const TOPIC = "chrome-document-global-created";

function observe(window, topic, url) {
    if (topic === TOPIC)
        checkDocument(window.document);
}
function init(id) {
    if (id)
        ADDON_ID = id;

    Services.obs[id ? "addObserver" : "removeObserver"](observe, TOPIC, false);
    for (let doc in chromeDocuments())
        checkDocument(doc, !id);
}
function cleanup() { init(null); }

function checkPopup(event) {
    let doc = event.originalTarget.ownerDocument;
    let binding = doc.getBindingParent(event.originalTarget);
    if (binding && binding.addon && binding.addon.guid == ADDON_ID && !binding.addon.compatible) {
        let elem = doc.getAnonymousElementByAttribute(binding, "anonid", "stillworks");
        if (elem && elem.nextSibling) {
            elem.nextSibling.disabled = true;
            elem.nextSibling.setAttribute("tooltiptext", "Developer has opted out of incompatibility reports\n"+
                                                         "Development versions are available with updated support");
        }
    }
}

function checkDocument(doc, disable, force) {
    if (["interactive", "complete"].indexOf(doc.readyState) >= 0 || force && doc.readyState === "uninitialized") {
        if (OVERLAY_URLS.indexOf(doc.documentURI) >= 0)
            doc[disable ? "removeEventListener" : "addEventListener"]("popupshowing", checkPopup, false);
    }
    else {
        doc.addEventListener("DOMContentLoaded", function listener() {
            doc.removeEventListener("DOMContentLoaded", listener, false);
            checkDocument(doc, disable, true);
        }, false);
    }
}

function chromeDocuments() {
    let windows = Services.wm.getXULWindowEnumerator(null);
    while (windows.hasMoreElements()) {
        let window = windows.getNext().QueryInterface(Ci.nsIXULWindow);
        for each (let type in ["typeChrome", "typeContent"]) {
            let docShells = window.docShell.getDocShellEnumerator(Ci.nsIDocShellTreeItem[type],
                                                                  Ci.nsIDocShell.ENUMERATE_FORWARDS);
            while (docShells.hasMoreElements())
                try {
                yield docShells.getNext().QueryInterface(Ci.nsIDocShell).contentViewer.DOMDocument;
                }
                catch (e) {}
        }
    }
}

var EXPORTED_SYMBOLS = ["cleanup", "init"];

// vim: set fdm=marker sw=4 ts=4 et ft=javascript:
