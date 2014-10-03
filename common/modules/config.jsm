// Copyright (c) 2006-2008 by Martin Stubenschrott <stubenschrott@vimperator.org>
// Copyright (c) 2007-2011 by Doug Kearns <dougkearns@gmail.com>
// Copyright (c) 2008-2014 Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

let global = this;
defineModule("config", {
    exports: ["ConfigBase", "Config", "config"],
    require: ["io", "protocol", "services"]
});

lazyRequire("addons", ["AddonManager"]);
lazyRequire("cache", ["cache"]);
lazyRequire("dom", ["DOM"]);
lazyRequire("highlight", ["highlight"]);
lazyRequire("messages", ["_"]);
lazyRequire("prefs", ["localPrefs", "prefs"]);
lazyRequire("storage", ["storage", "File"]);
lazyRequire("styles", ["Styles"]);
lazyRequire("template", ["template"]);
lazyRequire("util", ["util"]);

function AboutHandler() {}
AboutHandler.prototype = {
    get classDescription() "About " + config.appName + " Page",

    classID: Components.ID("81495d80-89ee-4c36-a88d-ea7c4e5ac63f"),

    get contractID() services.ABOUT + config.name,

    QueryInterface: XPCOMUtils.generateQI([Ci.nsIAboutModule]),

    newChannel: function (uri) {
        let channel = Cc["@mozilla.org/network/io-service;1"].getService(Ci.nsIIOService)
                          .newChannel("dactyl://content/about.xul", null, null);
        channel.originalURI = uri;
        return channel;
    },

    getURIFlags: function (uri) Ci.nsIAboutModule.ALLOW_SCRIPT
};
var ConfigBase = Class("ConfigBase", {
    /**
     * Called on dactyl startup to allow for any arbitrary application-specific
     * initialization code. Must call superclass's init function.
     */
    init: function init() {
        this.loadConfig();

        util.trapErrors(() => {
            JSMLoader.registerFactory(JSMLoader.Factory(AboutHandler));
        });
        util.withProperErrors(() => {
            JSMLoader.registerFactory(JSMLoader.Factory(
                Protocol("dactyl", "{9c8f2530-51c8-4d41-b356-319e0b155c44}",
                         "resource://dactyl-content/")));
        });

        this.protocolLoaded = true;
        this.timeout(function () {
            cache.register("config.dtd", () => util.makeDTD(config.dtd),
                           true);
        });

        // FIXME: May not be ready before first window opens.
        AddonManager.getAddonByID("{972ce4c6-7e08-4474-a285-3208198ce6fd}", a => {
            if (!a.isActive)
                config.features.delete("default-theme");
        });

        services["dactyl:"].pages["dtd"] = () => [null, cache.get("config.dtd")];

        update(services["dactyl:"].providers, {
            "locale": function (uri, path) LocaleChannel("dactyl-locale", config.locale, path, uri),
            "locale-local": function (uri, path) LocaleChannel("dactyl-local-locale", config.locale, path, uri)
        });
    },

    get prefs() localPrefs,

    has: function (feature) this.features.has(feature),

    configFiles: [
        "resource://dactyl-common/config.json",
        "resource://dactyl-local/config.json"
    ],

    configs: Class.Memoize(function () this.configFiles.map(url => JSON.parse(File.readURL(url)))),

    loadConfig: function loadConfig(documentURL) {

        for (let config of this.configs) {
            if (documentURL)
                config = config.overlays && config.overlays[documentURL] || {};

            for (let [name, value] in Iterator(config)) {
                let prop = util.camelCase(name);

                if (isArray(this[prop]))
                    this[prop] = [].concat(this[prop], value);
                else if (isinstance(this[prop], ["Set"]))
                    for (let key of value)
                        this[prop].add(key);
                else if (isObject(this[prop])) {
                    if (isArray(value))
                        value = Set(value);

                    this[prop] = update({}, this[prop],
                                        iter([util.camelCase(k), value[k]]
                                             for (k in value)).toObject());
                }
                else
                    this[prop] = value;
            }
        }
    },

    modules: {
        global: ["addons",
                 "base",
                 "io",
                 ["bookmarkcache", "bookmarkcache"],
                 "buffer",
                 "cache",
                 "commands",
                 "completion",
                 "config",
                 "contexts",
                 "dom",
                 "downloads",
                 "finder",
                 "help",
                 "highlight",
                 "javascript",
                 "main",
                 "messages",
                 "options",
                 "overlay",
                 "prefs",
                 ["promises", "Promise", "Task", "promises"],
                 "protocol",
                 "sanitizer",
                 "services",
                 "storage",
                 "styles",
                 "template",
                 "util"],

        window: ["dactyl",
                 "modes",
                 "commandline",
                 "abbreviations",
                 "autocommands",
                 "editor",
                 "events",
                 "hints",
                 "key-processors",
                 "mappings",
                 "marks",
                 "mow",
                 "statusline"]
    },

    loadStyles: function loadStyles(force) {
        highlight.styleableChrome = this.styleableChrome;

        highlight.loadCSS(this.CSS.replace(/__MSG_(.*?)__/g,
                                           (m0, m1) => _(m1)));
        highlight.loadCSS(this.helpCSS.replace(/__MSG_(.*?)__/g,
                                               (m0, m1) => _(m1)));

        let hl = highlight.set("Find", "");
        hl.onChange = function () {
            function hex(val) ("#" + util.regexp.iterate(/\d+/g, val)
                                         .map(num => ("0" + Number(num).toString(16)).slice(-2))
                                         .join("")
                              ).slice(0, 7);

            let elem = services.appShell.hiddenDOMWindow.document.createElement("div");
            elem.style.cssText = this.cssText;

            let keys = iter(Styles.propertyIter(this.cssText)).map(p => p.name).toArray();
            let bg = keys.some(bind("test", /^background/));
            let fg = keys.indexOf("color") >= 0;

            let style = DOM(elem).style;
            prefs[bg ? "safeSet" : "safeReset"]("ui.textHighlightBackground", hex(style.backgroundColor));
            prefs[fg ? "safeSet" : "safeReset"]("ui.textHighlightForeground", hex(style.color));
        };
    },

    get addonID() this.name + "@dactyl.googlecode.com",

    addon: Class.Memoize(function () {
        return (JSMLoader.bootstrap || {}).addon ||
                    AddonManager.getAddonByID(this.addonID);
    }),

    get styleableChrome() Object.keys(this.overlays),

    /**
     * The current application locale.
     */
    appLocale: Class.Memoize(() => services.chromeRegistry.getSelectedLocale("global")),

    /**
     * The current dactyl locale.
     */
    locale: Class.Memoize(function () this.bestLocale(this.locales)),

    /**
     * The current application locale.
     */
    locales: Class.Memoize(function () {
        // TODO: Merge with completion.file code.
        function getDir(str) str.match(/^(?:.*[\/\\])?/)[0];

        let uri = "resource://dactyl-locale/";
        let jar = io.isJarURL(uri);
        if (jar) {
            let prefix = getDir(jar.JAREntry);
            var res = iter(s.slice(prefix.length).replace(/\/.*/, "")
                           for (s in io.listJar(jar.JARFile, prefix)))
                        .toArray();
        }
        else {
            res = array(f.leafName
                        // Fails on FF3: for (f in util.getFile(uri).iterDirectory())
                        for (f in values(util.getFile(uri).readDirectory()))
                        if (f.isDirectory())).array;
        }

        let exists = function exists(pkg) services["resource:"].hasSubstitution("dactyl-locale-" + pkg);

        return array.uniq([this.appLocale, this.appLocale.replace(/-.*/, "")]
                            .filter(exists)
                            .concat(res));
    }),

    /**
     * Returns the best locale match to the current locale from a list
     * of available locales.
     *
     * @param {[string]} list A list of available locales
     * @returns {string}
     */
    bestLocale: function (list) {
        return values([this.appLocale, this.appLocale.replace(/-.*/, ""),
                       "en", "en-US", list[0]])
            .find(bind("has", RealSet(list)));
    },

    /**
     * A list of all known registered chrome and resource packages.
     */
    get chromePackages() {
        // Horrible hack.
        let res = {};
        function process(manifest) {
            for (let line of manifest.split(/\n+/)) {
                let match = /^\s*(content|skin|locale|resource)\s+([^\s#]+)\s/.exec(line);
                if (match)
                    res[match[2]] = true;
            }
        }
        function processJar(file) {
            let jar = services.ZipReader(file.file);
            if (jar)
                try {
                    if (jar.hasEntry("chrome.manifest"))
                        process(File.readStream(jar.getInputStream("chrome.manifest")));
                }
                finally {
                    jar.close();
                }
        }

        for (let dir of ["UChrm", "AChrom"]) {
            dir = File(services.directory.get(dir, Ci.nsIFile));
            if (dir.exists() && dir.isDirectory())
                for (let file in dir.iterDirectory())
                    if (/\.manifest$/.test(file.leafName))
                        process(file.read());

            dir = File(dir.parent);
            if (dir.exists() && dir.isDirectory())
                for (let file in dir.iterDirectory())
                    if (/\.jar$/.test(file.leafName))
                        processJar(file);

            dir = dir.child("extensions");
            if (dir.exists() && dir.isDirectory())
                for (let ext in dir.iterDirectory()) {
                    if (/\.xpi$/.test(ext.leafName))
                        processJar(ext);
                    else {
                        if (ext.isFile())
                            ext = File(ext.read().replace(/\n*$/, ""));
                        let mf = ext.child("chrome.manifest");
                        if (mf.exists())
                            process(mf.read());
                    }
                }
        }
        return Object.keys(res).sort();
    },

    /**
     * Returns true if the current Gecko runtime is of the given version
     * or greater.
     *
     * @param {string} min The minimum required version. @optional
     * @param {string} max The maximum required version. @optional
     * @returns {boolean}
     */
    haveGecko: function (min, max) let ({ compare } = services.versionCompare,
                                        { platformVersion } = services.runtime)
        (min == null || compare(platformVersion, min) >= 0) &&
        (max == null || compare(platformVersion, max) < 0),

    /** Dactyl's notion of the current operating system platform. */
    OS: memoize({
        _arch: services.runtime.OS,
        /**
         * @property {string} The normalised name of the OS. This is one of
         *     "Windows", "Mac OS X" or "Unix".
         */
        get name() this.isWindows ? "Windows" : this.isMacOSX ? "Mac OS X" : "Unix",
        /** @property {boolean} True if the OS is Windows. */
        get isWindows() this._arch == "WINNT",
        /** @property {boolean} True if the OS is Mac OS X. */
        get isMacOSX() this._arch == "Darwin",
        /** @property {boolean} True if the OS is some other *nix variant. */
        get isUnix() !this.isWindows,
        /** @property {RegExp} A RegExp which matches illegal characters in path components. */
        get illegalCharacters() this.isWindows ? /[<>:"/\\|?*\x00-\x1f]/g : /[\/\x00]/g,

        get pathListSep() this.isWindows ? ";" : ":"
    }),

    /**
     * @property {string} The pathname of the VCS repository clone's root
     *     directory if the application is running from one via an extension
     *     proxy file.
     */
    VCSPath: Class.Memoize(function () {
        if (/pre$/.test(this.addon.version)) {
            let uri = util.newURI(this.addon.getResourceURI("").spec + "../.hg");
            if (uri instanceof Ci.nsIFileURL &&
                    uri.file.exists() &&
                    io.pathSearch("hg"))
                return uri.file.parent.path;
        }
        return null;
    }),

    /**
     * @property {string} The name of the VCS branch that the application is
     *     running from if using an extension proxy file or was built from if
     *     installed as an XPI.
     */
    branch: Class.Memoize(function () {
        if (this.VCSPath)
            return io.system(["hg", "-R", this.VCSPath, "branch"]).output;
        return (/pre-hg\d+-(\S*)/.exec(this.version) || [])[1];
    }),

    /** @property {string} The name of the current user profile. */
    profileName: Class.Memoize(function () {
        // NOTE: services.profile.selectedProfile.name doesn't return
        // what you might expect. It returns the last _actively_ selected
        // profile (i.e. via the Profile Manager or -P option) rather than the
        // current profile. These will differ if the current process was run
        // without explicitly selecting a profile.

        let dir = services.directory.get("ProfD", Ci.nsIFile);
        for (let prof in iter(services.profile.profiles))
            if (prof.QueryInterface(Ci.nsIToolkitProfile).rootDir.path === dir.path)
                return prof.name;
        return "unknown";
    }),

    /** @property {string} The Dactyl version string. */
    version: Class.Memoize(function () {
        if (this.VCSPath)
            return io.system(["hg", "-R", this.VCSPath, "log", "-r.",
                              "--template=hg{rev}-{branch}"]).output;

        return this.addon.version;
    }),

    buildDate: Class.Memoize(function () {
        if (this.VCSPath)
            return io.system(["hg", "-R", this.VCSPath, "log", "-r.",
                              "--template={date|isodate}"]).output;
        if ("@DATE@" !== "@" + "DATE@")
            return _("dactyl.created", "@DATE@");
    }),

    get fileExt() this.name.slice(0, -6),

    dtd: Class.Memoize(function ()
        iter(this.dtdExtra,
             (["dactyl." + k, v] for ([k, v] in iter(config.dtdDactyl))),
             (["dactyl." + s, config[s]] for (s of config.dtdStrings)))
            .toObject()),

    dtdDactyl: memoize({
        get name() config.name,
        get home() "http://5digits.org/",
        get apphome() this.home + this.name,
        code: "http://code.google.com/p/dactyl/",
        get issues() this.home + "bug/" + this.name,
        get plugins() "http://5digits.org/" + this.name + "/plugins",
        get faq() this.home + this.name + "/faq",

        "list.mailto": Class.Memoize(() => config.name + "@googlegroups.com"),
        "list.href": Class.Memoize(() => "http://groups.google.com/group/" + config.name),

        "hg.latest": Class.Memoize(function () this.code + "source/browse/"), // XXX
        "irc": "irc://irc.oftc.net/#pentadactyl"
    }),

    dtdExtra: {
        "xmlns.dactyl": "http://vimperator.org/namespaces/liberator",
        "xmlns.html":   "http://www.w3.org/1999/xhtml",
        "xmlns.xul":    "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",

        "tag.command-line": ["link", { xmlns: "dactyl", topic: "command-line" }, "command line"],
        "tag.status-line":  ["link", { xmlns: "dactyl", topic: "status-line" }, "status line"],
        "mode.command-line": ["link", { xmlns: "dactyl", topic: "command-line-mode" }, "Command Line"]
    },

    dtdStrings: [
        "appName",
        "fileExt",
        "host",
        "hostbin",
        "idName",
        "name",
        "version"
    ],

    helpStyles: /^(Help|StatusLine|REPL)|^(Boolean|Dense|Indicator|MoreMsg|Number|Object|Logo|Key(word)?|String)$/,
    styleHelp: function styleHelp() {
        if (!this.helpStyled) {
            for (let k in keys(highlight.loaded))
                if (this.helpStyles.test(k))
                    highlight.loaded[k] = true;
        }
        this.helpStyled = true;
    },

    Local: function Local(dactyl, modules, { document, window }) ({
        init: function init() {
            this.loadConfig(document.documentURI);

            let append = [
                    ["menupopup", { id: "viewSidebarMenu", xmlns: "xul" }],
                    ["broadcasterset", { id: "mainBroadcasterSet", xmlns: "xul" }]];

            for (let [id, [name, key, uri]] in Iterator(this.sidebars)) {
                append[0].push(
                        ["menuitem", { observes: "pentadactyl-" + id + "Sidebar", label: name,
                                       accesskey: key }]);
                append[1].push(
                        ["broadcaster", { id: "pentadactyl-" + id + "Sidebar", autoCheck: "false",
                                          type: "checkbox", group: "sidebar", sidebartitle: name,
                                          sidebarurl: uri,
                                          oncommand: "toggleSidebar(this.id || this.observes);" }]);
            }

            util.overlayWindow(window, { append: append });
        },

        get window() window,

        get document() document,

        ids: Class.Update({
            get commandContainer() document.documentElement.id
        }),

        browser: Class.Memoize(() => window.gBrowser),
        tabbrowser: Class.Memoize(() => window.gBrowser),

        get browserModes() [modules.modes.NORMAL],

        /**
         * @property {string} The ID of the application's main XUL window.
         */
        mainWindowId: document.documentElement.id,

        /**
         * @property {number} The height (px) that is available to the output
         *     window.
         */
        get outputHeight() this.browser.mPanelContainer.boxObject.height,

        tabStrip: Class.Memoize(function () document.getElementById("TabsToolbar") || this.tabbrowser.mTabContainer)
    }),

    /**
     * @property {Object} A mapping of names and descriptions
     *     of the autocommands available in this application. Primarily used
     *     for completion results.
     */
    autocommands: {},

    /**
     * @property {Object} A map of :command-complete option values to completer
     *     function names.
     */
    completers: {},

    /**
     * @property {Object} Application specific defaults for option values. The
     *     property names must be the options' canonical names, and the values
     *     must be strings as entered via :set.
     */
    optionDefaults: {},

    cleanups: {},

    /**
     * @property {Object} A map of dialogs available via the
     *      :dialog command. Property names map dialog names to an array
     *      with the following elements:
     *  [0] description - A description of the dialog, used in
     *                    command completion results for :dialog.
     *  [1] action - The function executed by :dialog.
     *  [2] test - Function which returns true if the dialog is available in
     *      the current window. @optional
     */
    dialogs: {},

    /**
     * @property {set} A list of features available in this
     *    application. Used extensively in feature test macros. Use
     *    dactyl.has(feature) to check for a feature's presence
     *    in this array.
     */
    features: RealSet(["default-theme"]),

    /**
     * @property {string} The file extension used for command script files.
     *     This is the name string sans "dactyl".
     */
    get fileExtension() this.name.slice(0, -6),

    guioptions: {},

    /**
     * @property {string} The name of the application that hosts the
     *     extension. E.g., "Firefox" or "XULRunner".
     */
    host: null,

    /**
     * @property {string} The name of the extension.
     *    Required.
     */
    name: null,

    /**
     * @property {[string]} A list of extra scripts in the dactyl or
     *    application namespaces which should be loaded before dactyl
     *    initialization.
     */
    scripts: [],

    sidebars: {},

    /**
     * @constant
     * @property {string} The default highlighting rules.
     * See {@link Highlights#loadCSS} for details.
     */
    CSS: Class.Memoize(() => File.readURL("resource://dactyl-skin/global-styles.css")),

    helpCSS: Class.Memoize(() => File.readURL("resource://dactyl-skin/help-styles.css"))
}, {
});
JSMLoader.loadSubScript("resource://dactyl-local-content/config.js", this);

config.INIT = update(Object.create(config.INIT), config.INIT, {
    init: function init(dactyl, modules, window) {
        init.superapply(this, arguments);

        let img = new window.Image;
        img.src = this.logo || "resource://dactyl-local-content/logo.png";
        img.onload = util.wrapCallback(function () {
            highlight.loadCSS(literal(function () /*
                !Logo  {
                     display:    inline-block;
                     background: url({src});
                     width:      {width}px;
                     height:     {height}px;
                }
            */$).replace(/\{(.*?)\}/g, (m, m1) => img[m1]));
            img = null;
        });
    },

    load: function load(dactyl, modules, window) {
        load.superapply(this, arguments);

        this.timeout(function () {
            if (this.branch && this.branch !== "default" &&
                    modules.yes_i_know_i_should_not_report_errors_in_these_branches_thanks.indexOf(this.branch) === -1)
                dactyl.warn(_("warn.notDefaultBranch", config.appName, this.branch));
        }, 1000);
    }
});

endModule();

// catch(e){ if (typeof e === "string") e = Error(e); dump(e.fileName+":"+e.lineNumber+": "+e+"\n" + e.stack); }

// vim: set fdm=marker sw=4 sts=4 ts=8 et ft=javascript:
