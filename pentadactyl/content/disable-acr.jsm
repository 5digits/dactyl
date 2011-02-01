// By Kris Maglione. Public Domain.
// Please feel free to copy and use at will.

const ADDON_ID     = "pentadactyl@dactyl.googlecode.com";

const OVERLAY_URLS = [
    "about:addons",
    "chrome://mozapps/content/extensions/extensions.xul"
];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");

function observe(subject, topic, data) {
    if (topic in observers)
        observers[topic](subject, data);
}
function init(disable) {
    for (let observer in observers)
        Services.obs[disable ? "removeObserver" : "addObserver"](observe, observer, false);
    for (let doc in chromeDocuments)
        checkDocument(doc, disable);
}
function cleanup() { init(true); }
var observers = {
    "chrome-document-global-created": function (window, uri) {
        checkDocument(window.document);
    }
}

function checkPopup(event) {
    try {
        let doc = event.originalTarget.ownerDocument;
        let binding = doc.getBindingParent(event.originalTarget);
        if (binding && binding.addon && binding.addon.guid == ADDON_ID && !binding.addon.compatible) {
            let elem = doc.getAnonymousElementByAttribute(binding, "anonid", "stillworks");
            if (elem && elem.nextSibling) {
                elem.nextSibling.disabled = true;
                elem.nextSibling.setAttribute("tooltiptext", "Developer has opted out of incompatibility reports");
            }
        }
    }
    catch (e) {
        Cu.reportError(e);
    }
}

function checkDocument(doc, disable, force) {
    if (["interactive", "complete"].indexOf(doc.readyState) >= 0 || force && doc.readyState === "uninitialized") {
        if (OVERLAY_URLS.indexOf(doc.documentURI) >= 0)
            doc[disable ? "removeEventListener" : "addEventListener"]("popupshowing", checkPopup, false);
    }
    else {
        doc.addEventListener("DOMContentLoaded", function listener() {
            try {
                doc.removeEventListener("DOMContentLoaded", listener, false);
                checkDocument(doc, disable, true);
            }
            catch (e) {
                Cu.reportError(e);
            }
        }, false);
    }
}

function chromeDocuments() {
    let windows = Services.ww.getXULWindowEnumerator(null);
    while (windows.hasMoreElements()) {
        let window = windows.getNext().QueryInterface(Ci.nsIXULWindow);
        let docShells = window.docShell.getDocShellEnumerator(Ci.nsIDocShell.typeChrome,
                                                              Ci.nsIDocShell.ENUMERATE_FORWARDS);
        while (docShells.hasMoreElements())
            yield docShells.getNext().containedDocShells.DOMDocument;
    }
}

var EXPORTED_SYMBOLS = ["cleanup", "init"];

// vim: set fdm=marker sw=4 ts=4 et:
