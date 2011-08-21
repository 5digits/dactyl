// Copyright (c) 2008-2011 by Kris Maglione <maglione.k at Gmail>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

try {

var global = this;
Components.utils.import("resource://dactyl/bootstrap.jsm");
defineModule("services", {
    exports: ["services"],
    use: ["util"]
}, this);

/**
 * A lazily-instantiated XPCOM class and service cache.
 */
var Services = Module("Services", {
    init: function () {
        this.services = {};

        this.add("annotation",          "@mozilla.org/browser/annotation-service;1",        "nsIAnnotationService");
        this.add("appShell",            "@mozilla.org/appshell/appShellService;1",          "nsIAppShellService");
        this.add("appStartup",          "@mozilla.org/toolkit/app-startup;1",               "nsIAppStartup");
        this.add("autoCompleteSearch",  "@mozilla.org/autocomplete/search;1?name=history",  "nsIAutoCompleteSearch");
        this.add("bookmarks",           "@mozilla.org/browser/nav-bookmarks-service;1",     "nsINavBookmarksService");
        this.add("bootstrap",           "@dactyl.googlecode.com/base/bootstrap");
        this.add("browserSearch",       "@mozilla.org/browser/search-service;1",            "nsIBrowserSearchService");
        this.add("cache",               "@mozilla.org/network/cache-service;1",             "nsICacheService");
        this.add("charset",             "@mozilla.org/charset-converter-manager;1",         "nsICharsetConverterManager");
        this.add("chromeRegistry",      "@mozilla.org/chrome/chrome-registry;1",            "nsIXULChromeRegistry");
        this.add("commandLineHandler",  "@mozilla.org/commandlinehandler/general-startup;1?type=dactyl");
        this.add("console",             "@mozilla.org/consoleservice;1",                    "nsIConsoleService");
        this.add("dactyl:",             "@mozilla.org/network/protocol;1?name=dactyl");
        this.add("debugger",            "@mozilla.org/js/jsd/debugger-service;1",           "jsdIDebuggerService");
        this.add("directory",           "@mozilla.org/file/directory_service;1",            "nsIProperties");
        this.add("downloadManager",     "@mozilla.org/download-manager;1",                  "nsIDownloadManager");
        this.add("environment",         "@mozilla.org/process/environment;1",               "nsIEnvironment");
        this.add("extensionManager",    "@mozilla.org/extensions/manager;1",                "nsIExtensionManager");
        this.add("externalProtocol",    "@mozilla.org/uriloader/external-protocol-service;1", "nsIExternalProtocolService");
        this.add("favicon",             "@mozilla.org/browser/favicon-service;1",           "nsIFaviconService");
        this.add("file:",               "@mozilla.org/network/protocol;1?name=file",        "nsIFileProtocolHandler");
        this.add("focus",               "@mozilla.org/focus-manager;1",                     "nsIFocusManager");
        this.add("history",             "@mozilla.org/browser/global-history;2",
                 ["nsIBrowserHistory", "nsIGlobalHistory3", "nsINavHistoryService", "nsPIPlacesDatabase"]);
        this.add("io",                  "@mozilla.org/network/io-service;1",                "nsIIOService");
        this.add("json",                "@mozilla.org/dom/json;1",                          "nsIJSON", "createInstance");
        this.add("listeners",           "@mozilla.org/eventlistenerservice;1",              "nsIEventListenerService");
        this.add("livemark",            "@mozilla.org/browser/livemark-service;2",          "nsILivemarkService");
        this.add("mime",                "@mozilla.org/mime;1",                              "nsIMIMEService");
        this.add("observer",            "@mozilla.org/observer-service;1",                  "nsIObserverService");
        this.add("pref",                "@mozilla.org/preferences-service;1",               ["nsIPrefBranch2", "nsIPrefService"]);
        this.add("privateBrowsing",     "@mozilla.org/privatebrowsing;1",                   "nsIPrivateBrowsingService");
        this.add("profile",             "@mozilla.org/toolkit/profile-service;1",           "nsIToolkitProfileService");
        this.add("resource:",           "@mozilla.org/network/protocol;1?name=resource",    ["nsIProtocolHandler", "nsIResProtocolHandler"]);
        this.add("runtime",             "@mozilla.org/xre/runtime;1",                       ["nsIXULAppInfo", "nsIXULRuntime"]);
        this.add("rdf",                 "@mozilla.org/rdf/rdf-service;1",                   "nsIRDFService");
        this.add("sessionStore",        "@mozilla.org/browser/sessionstore;1",              "nsISessionStore");
        this.add("spell",               "@mozilla.org/spellchecker/engine;1",               "mozISpellCheckingEngine");
        this.add("stringBundle",        "@mozilla.org/intl/stringbundle;1",                 "nsIStringBundleService");
        this.add("stylesheet",          "@mozilla.org/content/style-sheet-service;1",       "nsIStyleSheetService");
        this.add("subscriptLoader",     "@mozilla.org/moz/jssubscript-loader;1",            "mozIJSSubScriptLoader");
        this.add("tagging",             "@mozilla.org/browser/tagging-service;1",           "nsITaggingService");
        this.add("tld",                 "@mozilla.org/network/effective-tld-service;1",     "nsIEffectiveTLDService");
        this.add("threading",           "@mozilla.org/thread-manager;1",                    "nsIThreadManager");
        this.add("urifixup",            "@mozilla.org/docshell/urifixup;1",                 "nsIURIFixup");
        this.add("versionCompare",      "@mozilla.org/xpcom/version-comparator;1",          "nsIVersionComparator");
        this.add("windowMediator",      "@mozilla.org/appshell/window-mediator;1",          "nsIWindowMediator");
        this.add("windowWatcher",       "@mozilla.org/embedcomp/window-watcher;1",          "nsIWindowWatcher");
        this.add("zipReader",           "@mozilla.org/libjar/zip-reader-cache;1",           "nsIZipReaderCache");

        this.addClass("CharsetConv",  "@mozilla.org/intl/scriptableunicodeconverter", "nsIScriptableUnicodeConverter", "charset");
        this.addClass("File",         "@mozilla.org/file/local;1",                 "nsILocalFile");
        this.addClass("Find",         "@mozilla.org/embedcomp/rangefind;1",        "nsIFind");
        this.addClass("HtmlConverter","@mozilla.org/widget/htmlformatconverter;1", "nsIFormatConverter");
        this.addClass("HtmlEncoder",  "@mozilla.org/layout/htmlCopyEncoder;1",     "nsIDocumentEncoder");
        this.addClass("InterfacePointer", "@mozilla.org/supports-interface-pointer;1", "nsISupportsInterfacePointer", "data");
        this.addClass("InputStream",  "@mozilla.org/scriptableinputstream;1",      "nsIScriptableInputStream", "init");
        this.addClass("Persist",      "@mozilla.org/embedding/browser/nsWebBrowserPersist;1", "nsIWebBrowserPersist");
        this.addClass("Pipe",         "@mozilla.org/pipe;1",                       "nsIPipe", "init");
        this.addClass("Process",      "@mozilla.org/process/util;1",               "nsIProcess", "init");
        this.addClass("StreamChannel","@mozilla.org/network/input-stream-channel;1",
                      ["nsIInputStreamChannel", "nsIChannel"], "setURI");
        this.addClass("StreamCopier", "@mozilla.org/network/async-stream-copier;1","nsIAsyncStreamCopier", "init");
        this.addClass("String",       "@mozilla.org/supports-string;1",            "nsISupportsString", "data");
        this.addClass("StringStream", "@mozilla.org/io/string-input-stream;1",     "nsIStringInputStream", "data");
        this.addClass("Transfer",     "@mozilla.org/transfer;1",                   "nsITransfer", "init");
        this.addClass("Timer",        "@mozilla.org/timer;1",                      "nsITimer", "initWithCallback");
        this.addClass("URL",          "@mozilla.org/network/standard-url;1",       ["nsIStandardURL", "nsIURL"], "init");
        this.addClass("Xmlhttp",      "@mozilla.org/xmlextras/xmlhttprequest;1",   "nsIXMLHttpRequest", "open");
        this.addClass("XPathEvaluator", "@mozilla.org/dom/xpath-evaluator;1",      "nsIDOMXPathEvaluator");
        this.addClass("XMLDocument",  "@mozilla.org/xml/xml-document;1",           ["nsIDOMXMLDocument", "nsIDOMNodeSelector"]);
        this.addClass("ZipReader",    "@mozilla.org/libjar/zip-reader;1",          "nsIZipReader", "open");
        this.addClass("ZipWriter",    "@mozilla.org/zipwriter;1",                  "nsIZipWriter");
    },
    reinit: function () {},

    _create: function (name, args) {
        try {
            var service = this.services[name];

            let res = Cc[service.class][service.method || "getService"]();
            if (!service.interfaces.length)
                return res.wrappedJSObject;

            service.interfaces.forEach(function (iface) res.QueryInterface(Ci[iface]));
            if (service.init && args.length) {
                if (service.callable)
                    res[service.init].apply(res, args);
                else
                    res[service.init] = args[0];
            }
            return res;
        }
        catch (e) {
            if (typeof util !== "undefined")
                util.reportError(e);
            else
                dump("dactyl: Service creation failed for '" + service.class + "': " + e + "\n" + (e.stack || Error(e).stack));
            return null;
        }
    },

    /**
     * Adds a new XPCOM service to the cache.
     *
     * @param {string} name The service's cache key.
     * @param {string} class The class's contract ID.
     * @param {string|[string]} ifaces The interface or array of
     *     interfaces implemented by this service.
     * @param {string} meth The name of the function used to instantiate
     *     the service.
     */
    add: function (name, class_, ifaces, meth) {
        const self = this;
        this.services[name] = { method: meth, class: class_, interfaces: Array.concat(ifaces || []) };
        if (name in this && ifaces && !this.__lookupGetter__(name) && !(this[name] instanceof Ci.nsISupports))
            throw TypeError();
        memoize(this, name, function () self._create(name));
    },

    /**
     * Adds a new XPCOM class to the cache.
     *
     * @param {string} name The class's cache key.
     * @param {string} class_ The class's contract ID.
     * @param {string|[string]} ifaces The interface or array of
     *     interfaces implemented by this class.
     * @param {string} init Name of a property or method used to initialize the
     *     class.
     */
    addClass: function (name, class_, ifaces, init) {
        const self = this;
        this.services[name] = { class: class_, interfaces: Array.concat(ifaces || []), method: "createInstance", init: init };
        if (init)
            memoize(this.services[name], "callable",
                    function () callable(XPCOMShim(this.interfaces)[this.init]));

        this[name] = function () self._create(name, arguments);
        update.apply(null, [this[name]].concat([Ci[i] for each (i in Array.concat(ifaces))]));
        return this[name];
    },

    /**
     * Returns a new instance of the cached class with the specified name.
     *
     * @param {string} name The class's cache key.
     */
    create: deprecated("services.*name*()", function create(name) this[util.capitalize(name)]()),

    /**
     * Returns the cached service with the specified name.
     *
     * @param {string} name The service's cache key.
     */
    get: deprecated("services.*name*", function get(name) this[name]),

    /**
     * Returns true if the given service is available.
     *
     * @param {string} name The service's cache key.
     */
    has: function (name) Set.has(this.services, name) && this.services[name].class in Cc &&
        this.services[name].interfaces.every(function (iface) iface in Ci)
}, {
}, {
    javascript: function (dactyl, modules) {
        modules.JavaScript.setCompleter(this.get, [function () [[k, v] for ([k, v] in Iterator(services)) if (v instanceof Ci.nsISupports)]]);
    }
});

endModule();

} catch(e){dump(e.fileName+":"+e.lineNumber+": "+e+"\n" + e.stack);}

// vim: set fdm=marker sw=4 sts=4 et ft=javascript:
