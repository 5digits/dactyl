// Copyright (c) 2008-2014 Kris Maglione <maglione.k at Gmail>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

try {

var global = this;
defineModule("services", {
    exports: ["PrivateBrowsingUtils", "services"]
});

try {
    var { PrivateBrowsingUtils } = Cu.import("resource://gre/modules/PrivateBrowsingUtils.jsm");
}
catch (e) {}

/**
 * A lazily-instantiated XPCOM class and service cache.
 */
var Services = Module("Services", {
    ABOUT: "@mozilla.org/network/protocol/about;1?what=",
    AUTOCOMPLETE: "@mozilla.org/autocomplete/search;1?name=",
    PROTOCOL: "@mozilla.org/network/protocol;1?name=",

    init: function () {
        this.services = {};

        this.add("annotation",          "@mozilla.org/browser/annotation-service;1",        "nsIAnnotationService");
        this.add("appShell",            "@mozilla.org/appshell/appShellService;1",          "nsIAppShellService");
        this.add("appStartup",          "@mozilla.org/toolkit/app-startup;1",               "nsIAppStartup");
        this.add("bookmarks",           "@mozilla.org/browser/nav-bookmarks-service;1",     "nsINavBookmarksService");
        this.add("browserSearch",       "@mozilla.org/browser/search-service;1",            "nsIBrowserSearchService");
        this.add("cache",               "@mozilla.org/netwerk/cache-storage-service;1",     "nsICacheStorageService");
        this.add("chromeRegistry",      "@mozilla.org/chrome/chrome-registry;1",            "nsIXULChromeRegistry");
        this.add("clipboard",           "@mozilla.org/widget/clipboard;1",                  "nsIClipboard");
        this.add("clipboardHelper",     "@mozilla.org/widget/clipboardhelper;1",            "nsIClipboardHelper");
        this.add("commandLineHandler",  "@mozilla.org/commandlinehandler/general-startup;1?type=dactyl");
        this.add("console",             "@mozilla.org/consoleservice;1",                    "nsIConsoleService");
        this.add("contentPrefs",        "@mozilla.org/content-pref/service;1",              ["nsIContentPrefService",
                                                                                             "nsIContentPrefService2"]);
        this.add("dactyl",              "@dactyl.googlecode.com/extra/utils",               "dactylIUtils");
        this.add("dactyl:",             this.PROTOCOL + "dactyl");
        this.add("directory",           "@mozilla.org/file/directory_service;1",            "nsIProperties");
        this.add("downloadManager",     "@mozilla.org/download-manager;1",                  "nsIDownloadManager");
        this.add("environment",         "@mozilla.org/process/environment;1",               "nsIEnvironment");
        this.add("extensionManager",    "@mozilla.org/extensions/manager;1",                "nsIExtensionManager");
        this.add("externalApp",         "@mozilla.org/uriloader/external-helper-app-service;1", "nsPIExternalAppLauncher");
        this.add("externalProtocol",    "@mozilla.org/uriloader/external-protocol-service;1", "nsIExternalProtocolService");
        this.add("favicon",             "@mozilla.org/browser/favicon-service;1",           "nsIFaviconService");
        this.add("file:",               this.PROTOCOL + "file",                             "nsIFileProtocolHandler");
        this.add("focus",               "@mozilla.org/focus-manager;1",                     "nsIFocusManager");
        this.add("history",             "@mozilla.org/browser/nav-history-service;1",
                 ["nsIBrowserHistory", "nsINavHistoryService", "nsPIPlacesDatabase"]);
        this.add("io",                  "@mozilla.org/network/io-service;1",                "nsIIOService");
        this.add("json",                "@mozilla.org/dom/json;1",                          "nsIJSON", "createInstance");
        this.add("listeners",           "@mozilla.org/eventlistenerservice;1",              "nsIEventListenerService");
        this.add("livemark",            "@mozilla.org/browser/livemark-service;2",          "nsILivemarkService");
        this.add("messages",            "@mozilla.org/globalmessagemanager;1",              "nsIChromeFrameMessageManager");
        this.add("mime",                "@mozilla.org/mime;1",                              "nsIMIMEService");
        this.add("observer",            "@mozilla.org/observer-service;1",                  "nsIObserverService");
        this.add("pref",                "@mozilla.org/preferences-service;1",               ["nsIPrefBranch2", "nsIPrefService"]);
        this.add("printSettings",       "@mozilla.org/gfx/printsettings-service;1",         "nsIPrintSettingsService");
        this.add("privateBrowsing",     "@mozilla.org/privatebrowsing;1",                   "nsIPrivateBrowsingService");
        this.add("profile",             "@mozilla.org/toolkit/profile-service;1",           "nsIToolkitProfileService");
        this.add("resource:",           this.PROTOCOL + "resource",                         ["nsIProtocolHandler", "nsIResProtocolHandler"]);
        this.add("runtime",             "@mozilla.org/xre/runtime;1",                       ["nsIXULAppInfo", "nsIXULRuntime"]);
        this.add("rdf",                 "@mozilla.org/rdf/rdf-service;1",                   "nsIRDFService");
        this.add("security",            "@mozilla.org/scriptsecuritymanager;1",             "nsIScriptSecurityManager");
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
        this.addClass("CharsetStream","@mozilla.org/intl/converter-input-stream;1",   ["nsIConverterInputStream",
                                                                                       "nsIUnicharLineInputStream"], "init");
        this.addClass("ConvOutStream","@mozilla.org/intl/converter-output-stream;1", "nsIConverterOutputStream", "init", false);
        this.addClass("File",         "@mozilla.org/file/local;1",                 "nsILocalFile");
        this.addClass("FileInStream", "@mozilla.org/network/file-input-stream;1",  "nsIFileInputStream", "init", false);
        this.addClass("FileOutStream","@mozilla.org/network/file-output-stream;1", "nsIFileOutputStream", "init", false);
        this.addClass("Find",         "@mozilla.org/embedcomp/rangefind;1",        "nsIFind");
        this.addClass("FormData",     "@mozilla.org/files/formdata;1",             "nsIDOMFormData");
        this.addClass("HtmlConverter","@mozilla.org/widget/htmlformatconverter;1", "nsIFormatConverter");
        this.addClass("HtmlEncoder",  "@mozilla.org/layout/htmlCopyEncoder;1",     "nsIDocumentEncoder");
        this.addClass("InterfacePointer", "@mozilla.org/supports-interface-pointer;1", "nsISupportsInterfacePointer", "data");
        this.addClass("InputStream",  "@mozilla.org/scriptableinputstream;1",      "nsIScriptableInputStream", "init");
        this.addClass("MIMEStream",   "@mozilla.org/network/mime-input-stream;1",  "nsIMIMEInputStream", "setData");
        this.addClass("Persist",      "@mozilla.org/embedding/browser/nsWebBrowserPersist;1", "nsIWebBrowserPersist");
        this.addClass("Pipe",         "@mozilla.org/pipe;1",                       "nsIPipe", "init");
        this.addClass("Process",      "@mozilla.org/process/util;1",               "nsIProcess", "init");
        this.addClass("Pump",         "@mozilla.org/network/input-stream-pump;1",  "nsIInputStreamPump", "init");
        this.addClass("StreamChannel","@mozilla.org/network/input-stream-channel;1",
                      ["nsIInputStreamChannel", "nsIChannel"], "setURI");
        this.addClass("StreamCopier", "@mozilla.org/network/async-stream-copier;1","nsIAsyncStreamCopier", "init");
        this.addClass("String",       "@mozilla.org/supports-string;1",            "nsISupportsString", "data");
        this.addClass("StringStream", "@mozilla.org/io/string-input-stream;1",     "nsIStringInputStream", "data");
        this.addClass("Transfer",     "@mozilla.org/transfer;1",                   "nsITransfer", "init");
        this.addClass("Transferable", "@mozilla.org/widget/transferable;1",        "nsITransferable");
        this.addClass("Timer",        "@mozilla.org/timer;1",                      "nsITimer", "initWithCallback");
        this.addClass("URL",          "@mozilla.org/network/standard-url;1",       ["nsIStandardURL", "nsIURL"], "init");
        this.addClass("Xmlhttp",      "@mozilla.org/xmlextras/xmlhttprequest;1",   [], "open");
        this.addClass("XPathEvaluator", "@mozilla.org/dom/xpath-evaluator;1",      "nsIDOMXPathEvaluator");
        this.addClass("XMLDocument",  "@mozilla.org/xml/xml-document;1",           "nsIDOMXMLDocument");
        this.addClass("XMLSerializer","@mozilla.org/xmlextras/xmlserializer;1",    ["nsIDOMSerializer"]);
        this.addClass("ZipReader",    "@mozilla.org/libjar/zip-reader;1",          "nsIZipReader", "open", false);
        this.addClass("ZipWriter",    "@mozilla.org/zipwriter;1",                  "nsIZipWriter", "open", false);
    },
    reinit: function () {},

    _create: function _create(name, args) {
        try {
            var service = this.services[name];

            let res = Cc[service.class][service.method || "getService"]();
            if (!service.interfaces.length)
                return res.wrappedJSObject || res;

            service.interfaces.forEach(iface => { res instanceof Ci[iface]; });

            if (service.init && args.length) {
                if (service.callable)
                    res[service.init].apply(res, args);
                else
                    res[service.init] = args[0];
            }
            return res;
        }
        catch (e) {
            if (service.quiet === false)
                throw e.stack ? e : Error(e);

            if (typeof util !== "undefined" && util != null)
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
    add: function add(name, class_, ifaces, meth) {
        const self = this;
        this.services[name] = { method: meth, class: class_, interfaces: Array.concat(ifaces || []) };
        if (name in this && ifaces && !this.__lookupGetter__(name) && !(this[name] instanceof Ci.nsISupports))
            throw TypeError();
        memoize(this, name, () => self._create(name));
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
    addClass: function addClass(name, class_, ifaces, init, quiet) {
        this.services[name] = { class: class_, interfaces: Array.concat(ifaces || []), method: "createInstance", init: init, quiet: quiet };
        if (init)
            memoize(this.services[name], "callable",
                    function () callable(XPCOMShim(this.interfaces)[this.init]));

        this[name] = (function Create() this._create(name, arguments)).bind(this);
        update.apply(null, [this[name]].concat([Ci[i] for (i of Array.concat(ifaces))]));
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
    has: function has(name) hasOwnProperty(this.services, name) && this.services[name].class in Cc &&
        this.services[name].interfaces.every(iface => iface in Ci)
});

endModule();

} catch(e){dump(e.fileName+":"+e.lineNumber+": "+e+"\n" + e.stack);}

// vim: set fdm=marker sw=4 sts=4 ts=8 et ft=javascript:
