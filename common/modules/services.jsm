// Copyright (c) 2008-2020 by Kris Maglione <maglione.k at Gmail>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";
try {
Components.utils.import("resource://dactyl/base.jsm");
defineModule("services", {
    exports: ["Services", "services"],
    use: ["util"]
});

/**
 * A lazily-instantiated XPCOM class and service cache.
 */
const Services = Module("Services", {
    init: function () {
        this.classes = {};
        this.services = {};

        this.add("annotation",          "@mozilla.org/browser/annotation-service;1",        Ci.nsIAnnotationService);
        this.add("appShell",            "@mozilla.org/appshell/appShellService;1",          Ci.nsIAppShellService);
        this.add("appStartup",          "@mozilla.org/toolkit/app-startup;1",               Ci.nsIAppStartup);
        this.add("autoCompleteSearch",  "@mozilla.org/autocomplete/search;1?name=history",  Ci.nsIAutoCompleteSearch);
        this.add("bookmarks",           "@mozilla.org/browser/nav-bookmarks-service;1",     Ci.nsINavBookmarksService);
        this.add("browserSearch",       "@mozilla.org/browser/search-service;1",            Ci.nsIBrowserSearchService);
        this.add("cache",               "@mozilla.org/network/cache-service;1",             Ci.nsICacheService);
        this.add("charset",             "@mozilla.org/charset-converter-manager;1",         Ci.nsICharsetConverterManager);
        this.add("console",             "@mozilla.org/consoleservice;1",                    Ci.nsIConsoleService);
        this.add("dactyl:",             "@mozilla.org/network/protocol;1?name=dactyl");
        this.add("debugger",            "@mozilla.org/js/jsd/debugger-service;1",           Ci.jsdIDebuggerService);
        this.add("directory",           "@mozilla.org/file/directory_service;1",            Ci.nsIProperties);
        this.add("downloadManager",     "@mozilla.org/download-manager;1",                  Ci.nsIDownloadManager);
        this.add("environment",         "@mozilla.org/process/environment;1",               Ci.nsIEnvironment);
        this.add("extensionManager",    "@mozilla.org/extensions/manager;1",                Ci.nsIExtensionManager);
        this.add("favicon",             "@mozilla.org/browser/favicon-service;1",           Ci.nsIFaviconService);
        this.add("history",             "@mozilla.org/browser/global-history;2",            [Ci.nsIBrowserHistory, Ci.nsIGlobalHistory3,
                                                                                             Ci.nsINavHistoryService, Ci.nsPIPlacesDatabase]);
        this.add("io",                  "@mozilla.org/network/io-service;1",                Ci.nsIIOService);
        this.add("json",                "@mozilla.org/dom/json;1",                          Ci.nsIJSON, "createInstance");
        this.add("livemark",            "@mozilla.org/browser/livemark-service;2",          Ci.nsILivemarkService);
        this.add("observer",            "@mozilla.org/observer-service;1",                  Ci.nsIObserverService);
        this.add("pref",                "@mozilla.org/preferences-service;1",               [Ci.nsIPrefBranch2, Ci.nsIPrefService]);
        this.add("privateBrowsing",     "@mozilla.org/privatebrowsing;1",                   Ci.nsIPrivateBrowsingService);
        this.add("profile",             "@mozilla.org/toolkit/profile-service;1",           Ci.nsIToolkitProfileService);
        this.add("runtime",             "@mozilla.org/xre/runtime;1",                       [Ci.nsIXULAppInfo, Ci.nsIXULRuntime]);
        this.add("rdf",                 "@mozilla.org/rdf/rdf-service;1",                   Ci.nsIRDFService);
        this.add("sessionStore",        "@mozilla.org/browser/sessionstore;1",              Ci.nsISessionStore);
        this.add("stringBundle",        "@mozilla.org/intl/stringbundle;1",                 Ci.nsIStringBundleService);
        this.add("stylesheet",          "@mozilla.org/content/style-sheet-service;1",       Ci.nsIStyleSheetService);
        this.add("subscriptLoader",     "@mozilla.org/moz/jssubscript-loader;1",            Ci.mozIJSSubScriptLoader);
        this.add("tagging",             "@mozilla.org/browser/tagging-service;1",           Ci.nsITaggingService);
        this.add("threadManager",       "@mozilla.org/thread-manager;1",                    Ci.nsIThreadManager);
        this.add("urifixup",            "@mozilla.org/docshell/urifixup;1",                 Ci.nsIURIFixup);
        this.add("windowMediator",      "@mozilla.org/appshell/window-mediator;1",          Ci.nsIWindowMediator);
        this.add("windowWatcher",       "@mozilla.org/embedcomp/window-watcher;1",          Ci.nsIWindowWatcher);


        this.addClass("file",         "@mozilla.org/file/local;1",                 Ci.nsILocalFile);
        this.addClass("file:",        "@mozilla.org/network/protocol;1?name=file", Ci.nsIFileProtocolHandler);
        this.addClass("find",         "@mozilla.org/embedcomp/rangefind;1",        Ci.nsIFind);
        this.addClass("htmlConverter","@mozilla.org/widget/htmlformatconverter;1", Ci.nsIFormatConverter);
        this.addClass("htmlEncoder",  "@mozilla.org/layout/htmlCopyEncoder;1",     Ci.nsIDocumentEncoder);
        this.addClass("process",      "@mozilla.org/process/util;1",               Ci.nsIProcess);
        this.addClass("string",       "@mozilla.org/supports-string;1",            Ci.nsISupportsString);
        this.addClass("timer",        "@mozilla.org/timer;1",                      Ci.nsITimer);
        this.addClass("xmlhttp",      "@mozilla.org/xmlextras/xmlhttprequest;1",   Ci.nsIXMLHttpRequest);
        this.addClass("zipWriter",    "@mozilla.org/zipwriter;1",                  Ci.nsIZipWriter);
    },

    _create: function (classes, ifaces, meth) {
        try {
            let res = Cc[classes][meth || "getService"]();
            if (!ifaces)
                return res.wrappedJSObject;
            ifaces = Array.concat(ifaces);
            ifaces.forEach(function (iface) res.QueryInterface(iface));
            return res;
        }
        catch (e) {
            // dactyl.log() is not defined at this time, so just dump any error
            util.dump("Service creation failed for '" + classes + "': " + e + "\n");
            return null;
        }
    },

    /**
     * Adds a new XPCOM service to the cache.
     *
     * @param {string} name The service's cache key.
     * @param {string} class The class's contract ID.
     * @param {nsISupports|nsISupports[]} ifaces The interface or array of
     *     interfaces implemented by this service.
     * @param {string} meth The name of the function used to instanciate
     *     the service.
     */
    add: function (name, class_, ifaces, meth) {
        const self = this;
        this.services.__defineGetter__(name, function () {
            delete this[name];
            return this[name] = self._create(class_, ifaces, meth);
        });
    },

    /**
     * Adds a new XPCOM class to the cache.
     *
     * @param {string} name The class's cache key.
     * @param {string} class The class's contract ID.
     * @param {nsISupports|nsISupports[]} ifaces The interface or array of
     *     interfaces implemented by this class.
     */
    addClass: function (name, class_, ifaces) {
        const self = this;
        return this.classes[name] = function () self._create(class_, ifaces, "createInstance");
    },

    /**
     * Returns a new instance of the cached class with the specified name.
     *
     * @param {string} name The class's cache key.
     */
    create: function (name) this.classes[name](),

    /**
     * Returns the cached service with the specified name.
     *
     * @param {string} name The service's cache key.
     */
    get: function (name) this.services[name],
}, {
}, {
    init: function (dactyl, modules) {
        if (!modules.AddonManager && !this.get("extensionManager"))
            Components.utils.import("resource://gre/modules/AddonManager.jsm", modules);
    },
    javascript: function (dactyl, modules) {
        modules.JavaScript.setCompleter(this.get, [function () services.services]);
        modules.JavaScript.setCompleter(this.create, [function () [[c, ""] for (c in services.classes)]]);
    }
});

endModule();

} catch(e){dump(e.fileName+":"+e.lineNumber+": "+e+"\n" + e.stack);}

// vim: set fdm=marker sw=4 sts=4 et ft=javascript:
