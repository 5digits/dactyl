// Copyright (c) 2006-2008 by Martin Stubenschrott <stubenschrott@vimperator.org>
// Copyright (c) 2007-2011 by Doug Kearns <dougkearns@gmail.com>
// Copyright (c) 2008-2011 by Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

try {

let global = this;
Components.utils.import("resource://dactyl/bootstrap.jsm");
defineModule("config", {
    exports: ["ConfigBase", "Config", "config"],
    require: ["services", "storage", "util", "template"],
    use: ["io", "messages", "prefs", "styles"]
}, this);

var ConfigBase = Class("ConfigBase", {
    /**
     * Called on dactyl startup to allow for any arbitrary application-specific
     * initialization code. Must call superclass's init function.
     */
    init: function init() {
        this.features.push = deprecated("Set.add", function push(feature) Set.add(this, feature));
        if (util.haveGecko("2b"))
            Set.add(this.features, "Gecko2");

        this.timeout(function () {
            services["dactyl:"].pages.dtd = function () [null, util.makeDTD(config.dtd)];
        });
    },

    loadStyles: function loadStyles(force) {
        const { highlight } = require("highlight");
        const { _ } = require("messages");

        highlight.styleableChrome = this.styleableChrome;

        highlight.loadCSS(this.CSS.replace(/__MSG_(.*?)__/g, function (m0, m1) _(m1)));
        highlight.loadCSS(this.helpCSS.replace(/__MSG_(.*?)__/g, function (m0, m1) _(m1)));

        if (!util.haveGecko("2b"))
            highlight.loadCSS(<![CDATA[
                !TabNumber               font-weight: bold; margin: 0px; padding-right: .8ex;
                !TabIconNumber {
                    font-weight: bold;
                    color: white;
                    text-align: center;
                    text-shadow: black -1px 0 1px, black 0 1px 1px, black 1px 0 1px, black 0 -1px 1px;
                }
            ]]>);

        let hl = highlight.set("Find", "");
        hl.onChange = function () {
            function hex(val) ("#" + util.regexp.iterate(/\d+/g, val)
                                         .map(function (num) ("0" + Number(num).toString(16)).slice(-2))
                                         .join("")
                              ).slice(0, 7);

            let elem = services.appShell.hiddenDOMWindow.document.createElement("div");
            elem.style.cssText = this.cssText;
            let style = util.computedStyle(elem);

            let keys = iter(Styles.propertyIter(this.cssText)).map(function (p) p.name).toArray();
            let bg = keys.some(function (k) /^background/.test(k));
            let fg = keys.indexOf("color") >= 0;

            prefs[bg ? "safeSet" : "safeReset"]("ui.textHighlightBackground", hex(style.backgroundColor));
            prefs[fg ? "safeSet" : "safeReset"]("ui.textHighlightForeground", hex(style.color));
        };
    },

    get addonID() this.name + "@dactyl.googlecode.com",
    addon: Class.memoize(function () {
        let addon;
        do {
            addon = (JSMLoader.bootstrap || {}).addon;
            if (addon && !addon.getResourceURI) {
                util.reportError(Error(_("addon.unavailable")));
                yield 10;
            }
        }
        while (addon && !addon.getResourceURI);

        if (!addon)
            addon = require("addons").AddonManager.getAddonByID(this.addonID);
        yield addon;
    }, true),

    /**
     * The current application locale.
     */
    appLocale: Class.memoize(function () services.chromeRegistry.getSelectedLocale("global")),

    /**
     * The current dactyl locale.
     */
    locale: Class.memoize(function () this.bestLocale(this.locales)),

    /**
     * The current application locale.
     */
    locales: Class.memoize(function () {
        // TODO: Merge with completion.file code.
        function getDir(str) str.match(/^(?:.*[\/\\])?/)[0];

        let uri = "resource://dactyl-locale/";
        let jar = io.isJarURL(uri);
        if (jar) {
            let prefix = getDir(jar.JAREntry);
            var res = iter(s.slice(prefix.length).replace(/\/.*/, "") for (s in io.listJar(jar.JARFile, prefix)))
                        .toArray();
        }
        else {
            res = array(f.leafName
                        // Fails on FF3: for (f in util.getFile(uri).iterDirectory())
                        for (f in values(util.getFile(uri).readDirectory()))
                        if (f.isDirectory())).array;
        }

        function exists(pkg) {
            try {
                services["resource:"].getSubstitution(pkg);
                return true;
            }
            catch (e) {
                return false;
            }
        }

        return array.uniq([this.appLocale, this.appLocale.replace(/-.*/, "")]
                            .filter(function (locale) exists("dactyl-locale-" + locale))
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
        let langs = Set(list);
        return values([this.appLocale, this.appLocale.replace(/-.*/, ""),
                       "en", "en-US", iter(langs).next()])
            .nth(function (l) Set.has(langs, l), 0);
    },

    /**
     * @property {string} The pathname of the VCS repository clone's root
     *     directory if the application is running from one via an extension
     *     proxy file.
     */
    VCSPath: Class.memoize(function () {
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
    branch: Class.memoize(function () {
        if (this.VCSPath)
            return io.system(["hg", "-R", this.VCSPath, "branch"]).output;
        return (/pre-hg\d+-(\S*)/.exec(this.version) || [])[1];
    }),

    /** @property {string} The Dactyl version string. */
    version: Class.memoize(function () {
        if (this.VCSPath)
            return io.system(["hg", "-R", this.VCSPath, "log", "-r.",
                              "--template=hg{rev}-" + this.branch + " ({date|isodate})"]).output;
        let version = this.addon.version;
        if ("@DATE@" !== "@" + "DATE@")
            version += " " + _("dactyl.created", "@DATE@");
        return version;
    }),

    get fileExt() this.name.slice(0, -6),

    dtd: Class.memoize(function ()
        iter(this.dtdExtra,
             (["dactyl." + k, v] for ([k, v] in iter(config.dtdDactyl))),
             (["dactyl." + s, config[s]] for each (s in config.dtdStrings)))
            .toObject()),

    dtdDactyl: memoize({
        get name() config.name,
        get home() "http://dactyl.sourceforge.net/",
        get apphome() this.home + this.name,
        code: "http://code.google.com/p/dactyl/",
        get issues() this.home + "bug/" + this.name,
        get plugins() "http://dactyl.sf.net/" + this.name + "/plugins",
        get faq() this.home + this.name + "/faq",

        "list.mailto": Class.memoize(function () config.name + "@googlegroups.com"),
        "list.href": Class.memoize(function () "http://groups.google.com/group/" + config.name),

        "hg.latest": Class.memoize(function () this.code + "source/browse/"), // XXX
        "irc": "irc://irc.oftc.net/#pentadactyl",
    }),

    dtdExtra: {
        "xmlns.dactyl": "http://vimperator.org/namespaces/liberator",
        "xmlns.html":   "http://www.w3.org/1999/xhtml",
        "xmlns.xul":    "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",

        "tag.command-line": <link topic="command-line">command line</link>,
        "tag.status-line":  <link topic="status-line">status line</link>,
        "mode.command-line": <link topic="command-line-mode">Command Line</link>,
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
            const { highlight } = require("highlight");
            for (let k in keys(highlight.loaded))
                if (this.helpStyles.test(k))
                    highlight.loaded[k] = true;
        }
        this.helpCSS = true;
    },

    Local: function Local(dactyl, modules, window) ({
        init: function init() {

            let append = <e4x xmlns={XUL} xmlns:dactyl={NS}>
                    <menupopup id="viewSidebarMenu"/>
                    <broadcasterset id="mainBroadcasterSet"/>
            </e4x>;
            for each (let [id, [name, key, uri]] in Iterator(this.sidebars)) {
                append.XUL::menupopup[0].* +=
                        <menuitem observes={"pentadactyl-" + id + "Sidebar"} label={name} accesskey={key} xmlns={XUL}/>;
                append.XUL::broadcasterset[0].* +=
                        <broadcaster id={"pentadactyl-" + id + "Sidebar"}
                            autoCheck="false" type="checkbox" group="sidebar"
                            sidebartitle={name} sidebarurl={uri}
                            oncommand="toggleSidebar(this.id || this.observes);" xmlns={XUL}/>;
            }

            util.overlayWindow(window, { append: append.elements() });
        },

        browser: Class.memoize(function () window.gBrowser),
        tabbrowser: Class.memoize(function () window.gBrowser),

        get browserModes() [modules.modes.NORMAL],

        /**
         * @property {string} The ID of the application's main XUL window.
         */
        mainWindowId: window.document.documentElement.id,

        /**
         * @property {number} The height (px) that is available to the output
         *     window.
         */
        get outputHeight() this.browser.mPanelContainer.boxObject.height,

        tabStrip: Class.memoize(function () window.document.getElementById("TabsToolbar") || this.tabbrowser.mTabContainer),
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
    completers: {
       abbreviation: "abbreviation",
       altstyle: "alternateStyleSheet",
       bookmark: "bookmark",
       buffer: "buffer",
       charset: "charset",
       color: "colorScheme",
       command: "command",
       dialog: "dialog",
       dir: "directory",
       environment: "environment",
       event: "autocmdEvent",
       extension: "extension",
       file: "file",
       help: "help",
       highlight: "highlightGroup",
       history: "history",
       javascript: "javascript",
       macro: "macro",
       mapping: "userMapping",
       mark: "mark",
       menu: "menuItem",
       option: "option",
       preference: "preference",
       qmark: "quickmark",
       runtime: "runtime",
       search: "search",
       shellcmd: "shellCommand",
       toolbar: "toolbar",
       url: "url",
       usercommand: "userCommand"
    },

    /**
     * @property {Object} Application specific defaults for option values. The
     *     property names must be the options' canonical names, and the values
     *     must be strings as entered via :set.
     */
    defaults: { guioptions: "rb" },
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
    features: {},

    /**
     * @property {string} The file extension used for command script files.
     *     This is the name string sans "dactyl".
     */
    get fileExtension() this.name.slice(0, -6),

    guioptions: {},

    hasTabbrowser: false,

    /**
     * @property {string} The name of the application that hosts the
     *     extension. E.g., "Firefox" or "XULRunner".
     */
    host: null,

    /**
     * @property {[[]]} An array of application specific mode specifications.
     *     The values of each mode are passed to modes.addMode during
     *     dactyl startup.
     */
    modes: [],

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
     * @property {string} The leaf name of any temp files created by
     *     {@link io.createTempFile}.
     */
    get tempFile() this.name + ".tmp",

    /**
     * @constant
     * @property {string} The default highlighting rules.
     * See {@link Highlights#loadCSS} for details.
     */
    CSS: UTF8(String.replace(<><![CDATA[
        // <css>
        Boolean      /* JavaScript booleans */       color: red;
        Function     /* JavaScript functions */      color: navy;
        Null         /* JavaScript null values */    color: blue;
        Number       /* JavaScript numbers */        color: blue;
        Object       /* JavaScript objects */        color: maroon;
        String       /* String values */             color: green; white-space: pre;
        Comment      /* JavaScriptor CSS comments */ color: gray;

        Key          /* Keywords */                  font-weight: bold;

        Enabled      /* Enabled item indicator text */  color: blue;
        Disabled     /* Disabled item indicator text */ color: red;

        FontFixed           /* The font used for fixed-width text */ \
                                             font-family: monospace !important;
        FontCode            /* The font used for code listings */ \
                            font-size: 9pt;  font-family: monospace !important;
        FontProportional    /* The font used for proportionally spaced text */ \
                            font-size: 10pt; font-family: "Droid Sans", "Helvetica LT Std", Helvetica, "DejaVu Sans", Verdana, sans-serif !important;

        // Hack to give these groups slightly higher precedence
        // than their unadorned variants.
        CmdCmdLine;[dactyl|highlight]>*  &#x0d; StatusCmdLine;[dactyl|highlight]>*
        CmdNormal;[dactyl|highlight]     &#x0d; StatusNormal;[dactyl|highlight]
        CmdErrorMsg;[dactyl|highlight]   &#x0d; StatusErrorMsg;[dactyl|highlight]
        CmdInfoMsg;[dactyl|highlight]    &#x0d; StatusInfoMsg;[dactyl|highlight]
        CmdModeMsg;[dactyl|highlight]    &#x0d; StatusModeMsg;[dactyl|highlight]
        CmdMoreMsg;[dactyl|highlight]    &#x0d; StatusMoreMsg;[dactyl|highlight]
        CmdQuestion;[dactyl|highlight]   &#x0d; StatusQuestion;[dactyl|highlight]
        CmdWarningMsg;[dactyl|highlight] &#x0d; StatusWarningMsg;[dactyl|highlight]

        Normal            /* Normal text */ \
                          color: black   !important; background: white       !important; font-weight: normal !important;
        StatusNormal      /* Normal text in the status line */ \
                          color: inherit !important; background: transparent !important;
        ErrorMsg          /* Error messages */ \
                          color: white   !important; background: red         !important; font-weight: bold !important;
        InfoMsg           /* Information messages */ \
                          color: black   !important; background: white       !important;
        StatusInfoMsg     /* Information messages in the status line */ \
                          color: inherit !important; background: transparent !important;
        LineNr            /* The line number of an error */ \
                          color: orange  !important; background: white       !important;
        ModeMsg           /* The mode indicator */ \
                          color: black   !important; background: white       !important;
        StatusModeMsg     /* The mode indicator in the status line */ \
                          color: inherit !important; background: transparent !important; padding-right: 1em;
        MoreMsg           /* The indicator that there is more text to view */ \
                          color: green   !important; background: white       !important;
        StatusMoreMsg                                background: transparent !important;
        Message           /* A message as displayed in <ex>:messages</ex> */ \
                          white-space: pre-wrap !important; min-width: 100%; width: 100%; padding-left: 4em; text-indent: -4em; display: block;
        Message String    /* A message as displayed in <ex>:messages</ex> */ \
                          white-space: pre-wrap;
        NonText           /* The <em>~</em> indicators which mark blank lines in the completion list */ \
                          color: blue; background: transparent !important;
        *Preview          /* The completion preview displayed in the &tag.command-line; */ \
                          color: gray;
        Question          /* A prompt for a decision */ \
                          color: green   !important; background: white       !important; font-weight: bold !important;
        StatusQuestion    /* A prompt for a decision in the status line */ \
                          color: green   !important; background: transparent !important;
        WarningMsg        /* A warning message */ \
                          color: red     !important; background: white       !important;
        StatusWarningMsg  /* A warning message in the status line */ \
                          color: red     !important; background: transparent !important;
        Disabled          /* Disabled items */ \
                          color: gray    !important;

        CmdLine;>*;;FontFixed   /* The command line */ \
                                padding: 1px !important;
        CmdPrompt;.dactyl-commandline-prompt  /* The default styling form the command prompt */
        CmdInput;.dactyl-commandline-command
        CmdOutput         /* The output of commands executed by <ex>:run</ex> */ \
                          white-space: pre;

        CompGroup                      /* Item group in completion output */
        CompGroup:not(:first-of-type)  margin-top: .5em;
        CompGroup:last-of-type         padding-bottom: 1.5ex;

        CompTitle            /* Completion row titles */ \
                             color: magenta; background: white; font-weight: bold;
        CompTitle>*          padding: 0 .5ex;
        CompTitleSep         /* The element which separates the completion title from its results */ \
                             height: 1px; background: magenta; background: -moz-linear-gradient(60deg, magenta, white);

        CompMsg              /* The message which may appear at the top of a group of completion results */ \
                             font-style: italic; margin-left: 16px;

        CompItem             /* A single row of output in the completion list */
        CompItem:nth-child(2n+1)    background: rgba(0, 0, 0, .04);
        CompItem[selected]   /* A selected row of completion list */ \
                             background: yellow;
        CompItem>*           padding: 0 .5ex;

        CompIcon             /* The favicon of a completion row */ \
                             width: 16px; min-width: 16px; display: inline-block; margin-right: .5ex;
        CompIcon>img         max-width: 16px; max-height: 16px; vertical-align: middle;

        CompResult           /* The result column of the completion list */ \
                             width: 36%; padding-right: 1%; overflow: hidden;
        CompDesc             /* The description column of the completion list */ \
                             color: gray; width: 62%; padding-left: 1em;

        CompLess             /* The indicator shown when completions may be scrolled up */ \
                             text-align: center; height: 0;    line-height: .5ex; padding-top: 1ex;
        CompLess::after      /* The character of indicator shown when completions may be scrolled up */ \
                             content: "⌃";

        CompMore             /* The indicator shown when completions may be scrolled down */ \
                             text-align: center; height: .5ex; line-height: .5ex; margin-bottom: -.5ex;
        CompMore::after      /* The character of indicator shown when completions may be scrolled down */ \
                             content: "⌄";

        Dense              /* Arbitrary elements which should be packed densely together */\
                           margin-top: 0; margin-bottom: 0;

        EditorEditing;;*   /* Text fields for which an external editor is open */ \
                           background-color: #bbb !important; -moz-user-input: none !important; -moz-user-modify: read-only !important;
        EditorError;;*     /* Text fields briefly after an error has occurred running the external editor */ \
                           background: red !important;
        EditorBlink1;;*    /* Text fields briefly after successfully running the external editor, alternated with EditorBlink2 */ \
                           background: yellow !important;
        EditorBlink2;;*    /* Text fields briefly after successfully running the external editor, alternated with EditorBlink1 */

        REPL                /* Read-Eval-Print-Loop output */ \
                            overflow: auto; max-height: 40em;
        REPL-R;;;Question   /* Prompts in REPL mode */
        REPL-E              /* Evaled input in REPL mode */ \
                            white-space: pre-wrap;
        REPL-P              /* Evaled output in REPL mode */ \
                            white-space: pre-wrap; margin-bottom: 1em;

        Usage               /* Output from the :*usage commands */ \
                            width: 100%;
        UsageHead           /* Headings in output from the :*usage commands */
        UsageBody           /* The body of listings in output from the :*usage commands */
        UsageItem           /* Individual items in output from the :*usage commands */
        UsageItem:nth-of-type(2n)    background: rgba(0, 0, 0, .04);

        Indicator   /* The <em>#</em> and  <em>%</em> in the <ex>:buffers</ex> list */ \
                    color: blue; width: 1.5em; text-align: center;
        Filter      /* The matching text in a completion list */ \
                    font-weight: bold;

        Keyword     /* A bookmark keyword for a URL */ \
                    color: red;
        Tag         /* A bookmark tag for a URL */ \
                    color: blue;

        Link                        /* A link with additional information shown on hover */ \
                                    position: relative; padding-right: 2em;
        Link:not(:hover)>LinkInfo   opacity: 0; left: 0; width: 1px; height: 1px; overflow: hidden;
        LinkInfo                    {
            /* Information shown when hovering over a link */
            color: black;
            position: absolute;
            left: 100%;
            padding: 1ex;
            margin: -1ex -1em;
            background: rgba(255, 255, 255, .8);
            border-radius: 1ex;
        }

        StatusLine;;;FontFixed  {
            /* The status bar */
            -moz-appearance: none !important;
            font-weight: bold;
            background: transparent !important;
            border: 0px !important;
            padding-right: 0px !important;
            min-height: 18px !important;
            text-shadow: none !important;
        }
        StatusLineNormal;[dactyl|highlight]    /* The status bar for an ordinary web page */ \
                                               color: white !important; background: black   !important;
        StatusLineBroken;[dactyl|highlight]    /* The status bar for a broken web page */ \
                                               color: black !important; background: #FFa0a0 !important; /* light-red */
        StatusLineSecure;[dactyl|highlight]    /* The status bar for a secure web page */ \
                                               color: black !important; background: #a0a0FF !important; /* light-blue */
        StatusLineExtended;[dactyl|highlight]  /* The status bar for a secure web page with an Extended Validation (EV) certificate */ \
                                               color: black !important; background: #a0FFa0 !important; /* light-green */

        !TabClose;.tab-close-button            /* The close button of a browser tab */ \
                                               /* The close button of a browser tab */
        !TabIcon;.tab-icon,.tab-icon-image     /* The icon of a browser tab */ \
                                               /* The icon of a browser tab */
        !TabText;.tab-text                     /* The text of a browser tab */
        TabNumber                              /* The number of a browser tab, next to its icon */ \
                                               font-weight: bold; margin: 0px; padding-right: .8ex; cursor: default;
        TabIconNumber  {
            /* The number of a browser tab, over its icon */
            cursor: default;
            width: 16px;
            margin: 0 2px 0 -18px !important;
            font-weight: bold;
            color: white;
            text-align: center;
            text-shadow: black -1px 0 1px, black 0 1px 1px, black 1px 0 1px, black 0 -1px 1px;
        }

        Title       /* The title of a listing, including <ex>:pageinfo</ex>, <ex>:jumps</ex> */ \
                    color: magenta; font-weight: bold;
        URL         /* A URL */ \
                    text-decoration: none; color: green; background: inherit;
        URL:hover   text-decoration: underline; cursor: pointer;
        URLExtra    /* Extra information about a URL */ \
                    color: gray;

        FrameIndicator;;* {
            /* The styling applied to briefly indicate the active frame */
            background-color: red;
            opacity: 0.5;
            z-index: 999999;
            position: fixed;
            top:      0;
            bottom:   0;
            left:     0;
            right:    0;
        }

        Bell          /* &dactyl.appName;’s visual bell */ \
                      background-color: black !important;

        Hint;;* {
            /* A hint indicator. See <ex>:help hints</ex> */
            font:        bold 10px "Droid Sans Mono", monospace !important;
            margin:      -.2ex;
            padding:     0 0 0 1px;
            outline:     1px solid rgba(0, 0, 0, .5);
            background:  rgba(255, 248, 231, .8);
            color:       black;
        }
        Hint[active];;*  background: rgba(255, 253, 208, .8);
        Hint::after;;*   content: attr(text) !important;
        HintElem;;*      /* The hintable element */ \
                         background-color: yellow  !important; color: black !important;
        HintActive;;*    /* The hint element of link which will be followed by <k name="CR"/> */ \
                         background-color: #88FF00 !important; color: black !important;
        HintImage;;*     /* The indicator which floats above hinted images */ \
                         opacity: .5 !important;

        Button                  /* A button widget */ \
                                display: inline-block; font-weight: bold; cursor: pointer; color: black; text-decoration: none;
        Button:hover            text-decoration: underline;
        Button[collapsed]       visibility: collapse; width: 0;
        Button::before          content: "["; color: gray; text-decoration: none !important;
        Button::after           content: "]"; color: gray; text-decoration: none !important;
        Button:not([collapsed]) ~ Button:not([collapsed])::before  content: "/[";

        Buttons                 /* A group of buttons */

        DownloadCell                    /* A table cell in the :downloads manager */ \
                                        display: table-cell; padding: 0 1ex;

        Downloads                       /* The :downloads manager */ \
                                        display: table; margin: 0; padding: 0;
        DownloadHead;;;CompTitle        /* A heading in the :downloads manager */ \
                                        display: table-row;
        DownloadHead>*;;;DownloadCell

        Download                        /* A download in the :downloads manager */ \
                                        display: table-row;
        Download:not([active])          color: gray;
        Download:nth-child(2n+1)        background: rgba(0, 0, 0, .04);

        Download>*;;;DownloadCell
        DownloadButtons                 /* A button group in the :downloads manager */
        DownloadPercent                 /* The percentage column for a download */
        DownloadProgress                /* The progress column for a download */
        DownloadProgressHave            /* The completed portion of the progress column */
        DownloadProgressTotal           /* The remaining portion of the progress column */
        DownloadSource                  /* The download source column for a download */
        DownloadState                   /* The download state column for a download */
        DownloadTime                    /* The time remaining column for a download */
        DownloadTitle                   /* The title column for a download */
        DownloadTitle>Link>a         max-width: 48ex; overflow: hidden; display: inline-block;

        AddonCell                    /* A cell in tell :addons manager */ \
                                     display: table-cell; padding: 0 1ex;

        Addons                       /* The :addons manager */ \
                                     display: table; margin: 0; padding: 0;
        AddonHead;;;CompTitle        /* A heading in the :addons manager */ \
                                     display: table-row;
        AddonHead>*;;;AddonCell

        Addon                        /* An add-on in the :addons manager */ \
                                     display: table-row;
        Addon:nth-child(2n+1)        background: rgba(0, 0, 0, .04);

        Addon>*;;;AddonCell
        AddonButtons
        AddonDescription
        AddonName                    max-width: 48ex; overflow: hidden;
        AddonStatus
        AddonVersion

        // </css>
    ]]></>, /&#x0d;/g, "\n")),

    helpCSS: UTF8(<><![CDATA[
        // <css>
        InlineHelpLink                              /* A help link shown in the command line or multi-line output area */ \
                                                    font-size: inherit !important; font-family: inherit !important;

        Help;;;FontProportional                     /* A help page */ \
                                                    line-height: 1.4em;

        HelpInclude                                 /* A help page included in the consolidated help listing */ \
                                                    margin: 2em 0;

        HelpArg;;;FontCode                          /* A required command argument indicator */ \
                                                    color: #6A97D4;
        HelpOptionalArg;;;FontCode                  /* An optional command argument indicator */ \
                                                    color: #6A97D4;

        HelpBody                                    /* The body of a help page */ \
                                                    display: block; margin: 1em auto; max-width: 100ex; padding-bottom: 1em; margin-bottom: 4em; border-bottom-width: 1px;
        HelpBorder;*;dactyl://help/*                /* The styling of bordered elements */ \
                                                    border-color: silver; border-width: 0px; border-style: solid;
        HelpCode;;;FontCode                         /* Code listings */ \
                                                    display: block; white-space: pre; margin-left: 2em;
        HelpTT;html|tt;dactyl://help/*;FontCode     /* Teletype text */

        HelpDefault;;;FontCode                      /* The default value of a help item */ \
                                                    display: inline-block; margin: -1px 1ex 0 0; white-space: pre; vertical-align: text-top;

        HelpDescription                             /* The description of a help item */ \
                                                    display: block; clear: right;
        HelpDescription[short]                      clear: none;
        HelpEm;html|em;dactyl://help/*              /* Emphasized text */ \
                                                    font-weight: bold; font-style: normal;

        HelpEx;;;FontCode                           /* An Ex command */ \
                                                    display: inline-block; color: #527BBD;

        HelpExample                                 /* An example */ \
                                                    display: block; margin: 1em 0;
        HelpExample::before                         content: "__MSG_help.Example__: "; font-weight: bold;

        HelpInfo                                    /* Arbitrary information about a help item */ \
                                                    display: block; width: 20em; margin-left: auto;
        HelpInfoLabel                               /* The label for a HelpInfo item */ \
                                                    display: inline-block; width: 6em;  color: magenta; font-weight: bold; vertical-align: text-top;
        HelpInfoValue                               /* The details for a HelpInfo item */ \
                                                    display: inline-block; width: 14em; text-decoration: none;             vertical-align: text-top;

        HelpItem                                    /* A help item */ \
                                                    display: block; margin: 1em 1em 1em 10em; clear: both;

        HelpKey;;;FontCode                          /* A keyboard key specification */ \
                                                    color: #102663;
        HelpKeyword                                 /* A keyword */ \
                                                    font-weight: bold; color: navy;

        HelpLink;html|a;dactyl://help/*             /* A hyperlink */ \
                                                    text-decoration: none !important;
        HelpLink[href]:hover                        text-decoration: underline !important;
        HelpLink[href^="mailto:"]::after            content: "✉"; padding-left: .2em;
        HelpLink[rel=external] {
            /* A hyperlink to an external resource */
            /* Thanks, Wikipedia */
            background: transparent url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAMAAAC67D+PAAAAFVBMVEVmmcwzmcyZzP8AZswAZv////////9E6giVAAAAB3RSTlP///////8AGksDRgAAADhJREFUGFcly0ESAEAEA0Ei6/9P3sEcVB8kmrwFyni0bOeyyDpy9JTLEaOhQq7Ongf5FeMhHS/4AVnsAZubxDVmAAAAAElFTkSuQmCC) no-repeat scroll right center;
            padding-right: 13px;
        }

        ErrorMsg HelpEx       color: inherit; background: inherit; text-decoration: underline;
        ErrorMsg HelpKey      color: inherit; background: inherit; text-decoration: underline;
        ErrorMsg HelpOption   color: inherit; background: inherit; text-decoration: underline;
        ErrorMsg HelpTopic    color: inherit; background: inherit; text-decoration: underline;

        HelpTOC               /* The Table of Contents for a help page */
        HelpTOC>ol ol         margin-left: -1em;

        HelpOrderedList;ol;dactyl://help/*                          /* Any ordered list */ \
                                                                    margin: 1em 0;
        HelpOrderedList1;ol[level="1"],ol;dactyl://help/*           /* A first-level ordered list */ \
                                                                    list-style: outside decimal; display: block;
        HelpOrderedList2;ol[level="2"],ol ol;dactyl://help/*        /* A second-level ordered list */ \
                                                                    list-style: outside upper-alpha;
        HelpOrderedList3;ol[level="3"],ol ol ol;dactyl://help/*     /* A third-level ordered list */ \
                                                                    list-style: outside lower-roman;
        HelpOrderedList4;ol[level="4"],ol ol ol ol;dactyl://help/*  /* A fourth-level ordered list */ \
                                                                    list-style: outside decimal;

        HelpList;html|ul;dactyl://help/*      /* An unordered list */ \
                                              display: block; list-style-position: outside; margin: 1em 0;
        HelpListItem;html|li;dactyl://help/*  /* A list item, ordered or unordered */ \
                                              display: list-item;

        HelpNote                                    /* The indicator for a note */ \
                                                    color: red; font-weight: bold;

        HelpOpt;;;FontCode                          /* An option name */ \
                                                    color: #106326;
        HelpOptInfo;;;FontCode                      /* Information about the type and default values for an option entry */ \
                                                    display: block; margin-bottom: 1ex; padding-left: 4em;

        HelpParagraph;html|p;dactyl://help/*        /* An ordinary paragraph */ \
                                                    display: block; margin: 1em 0em;
        HelpParagraph:first-child                   margin-top: 0;
        HelpParagraph:last-child                    margin-bottom: 0;
        HelpSpec;;;FontCode                         /* The specification for a help entry */ \
                                                    display: block; margin-left: -10em; float: left; clear: left; color: #527BBD; margin-right: 1em;

        HelpString;;;FontCode                       /* A quoted string */ \
                                                    color: green; font-weight: normal;
        HelpString::before                          content: '"';
        HelpString::after                           content: '"';
        HelpString[delim]::before                   content: attr(delim);
        HelpString[delim]::after                    content: attr(delim);

        HelpNews        /* A news item */           position: relative;
        HelpNewsOld     /* An old news item */      opacity: .7;
        HelpNewsNew     /* A new news item */       font-style: italic;
        HelpNewsTag     /* The version tag for a news item */ \
                        font-style: normal; position: absolute; left: 100%; padding-left: 1em; color: #527BBD; opacity: .6; white-space: pre;

        HelpHead;html|h1,html|h2,html|h3,html|h4;dactyl://help/* {
            /* Any help heading */
            font-weight: bold;
            color: #527BBD;
            clear: both;
        }
        HelpHead1;html|h1;dactyl://help/* {
            /* A first-level help heading */
            margin: 2em 0 1em;
            padding-bottom: .2ex;
            border-bottom-width: 1px;
            font-size: 2em;
        }
        HelpHead2;html|h2;dactyl://help/* {
            /* A second-level help heading */
            margin: 2em 0 1em;
            padding-bottom: .2ex;
            border-bottom-width: 1px;
            font-size: 1.2em;
        }
        HelpHead3;html|h3;dactyl://help/* {
            /* A third-level help heading */
            margin: 1em 0;
            padding-bottom: .2ex;
            font-size: 1.1em;
        }
        HelpHead4;html|h4;dactyl://help/* {
            /* A fourth-level help heading */
        }

        HelpTab;html|dl;dactyl://help/* {
            /* A description table */
            display: table;
            width: 100%;
            margin: 1em 0;
            border-bottom-width: 1px;
            border-top-width: 1px;
            padding: .5ex 0;
            table-layout: fixed;
        }
        HelpTabColumn;html|column;dactyl://help/*   display: table-column;
        HelpTabColumn:first-child                   width: 25%;
        HelpTabTitle;html|dt;dactyl://help/*;FontCode  /* The title column of description tables */ \
                                                    display: table-cell; padding: .1ex 1ex; font-weight: bold;
        HelpTabDescription;html|dd;dactyl://help/*  /* The description column of description tables */ \
                                                    display: table-cell; padding: .3ex 1em; text-indent: -1em; border-width: 0px;
        HelpTabDescription>*;;dactyl://help/*       text-indent: 0;
        HelpTabRow;html|dl>html|tr;dactyl://help/*  /* Entire rows in description tables */ \
                                                    display: table-row;

        HelpTag;;;FontCode                          /* A help tag */ \
                                                    display: inline-block; color: #527BBD; margin-left: 1ex; font-weight: normal;
        HelpTags                                    /* A group of help tags */ \
                                                    display: block; float: right; clear: right;
        HelpTopic;;;FontCode                        /* A link to a help topic */ \
                                                    color: #102663;
        HelpType;;;FontCode                         /* An option type */ \
                                                    color: #102663 !important; margin-right: 2ex;

        HelpWarning                                 /* The indicator for a warning */ \
                                                    color: red; font-weight: bold;

        HelpXML;;;FontCode                          /* Highlighted XML */ \
                                                    color: #C5F779; background-color: #444444; font-family: Terminus, Fixed, monospace;
        HelpXMLBlock {                              white-space: pre; color: #C5F779; background-color: #444444;
            border: 1px dashed #aaaaaa;
            display: block;
            margin-left: 2em;
            font-family: Terminus, Fixed, monospace;
        }
        HelpXMLAttribute                            color: #C5F779;
        HelpXMLAttribute::after                     color: #E5E5E5; content: "=";
        HelpXMLComment                              color: #444444;
        HelpXMLComment::before                      content: "<!--";
        HelpXMLComment::after                       content: "-->";
        HelpXMLProcessing                           color: #C5F779;
        HelpXMLProcessing::before                   color: #444444; content: "<?";
        HelpXMLProcessing::after                    color: #444444; content: "?>";
        HelpXMLString                               color: #C5F779; white-space: pre;
        HelpXMLString::before                       content: '"';
        HelpXMLString::after                        content: '"';
        HelpXMLNamespace                            color: #FFF796;
        HelpXMLNamespace::after                     color: #777777; content: ":";
        HelpXMLTagStart                             color: #FFF796; white-space: normal; display: inline-block; text-indent: -1.5em; padding-left: 1.5em;
        HelpXMLTagEnd                               color: #71BEBE;
        HelpXMLText                                 color: #E5E5E5;
        // </css>
    ]]></>)
}, {
});

JSMLoader.loadSubScript("resource://dactyl-local-content/config.js", this);

config.INIT = update(Object.create(config.INIT), config.INIT, {
    init: function init(dactyl, modules, window) {
        init.superapply(this, arguments);

        let img = window.Image();
        img.src = this.logo || "resource://dactyl-local-content/logo.png";
        img.onload = util.wrapCallback(function () {
            const { highlight } = require("highlight");
            highlight.loadCSS(<>{"!Logo  {"}
                     display:    inline-block;
                     background: url({img.src});
                     width:      {img.width}px;
                     height:     {img.height}px;
                 {"}"}</>);
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

} catch(e){ if (typeof e === "string") e = Error(e); dump(e.fileName+":"+e.lineNumber+": "+e+"\n" + e.stack); }

// vim: set fdm=marker sw=4 sts=4 et ft=javascript:
