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
    use: ["io"]
}, this);

var ConfigBase = Class("ConfigBase", {
    /**
     * Called on dactyl startup to allow for any arbitrary application-specific
     * initialization code. Must call superclass's init function.
     */
    init: function init() {
        this.features.push = deprecated("set.add", function push(feature) set.add(this, feature));
        if (util.haveGecko("2b"))
            set.add(this.features, "Gecko2");

        this.timeout(function () {
            services["dactyl:"].pages.dtd = function () [null,
                iter(config.dtdExtra,
                     (["dactyl." + k, v] for ([k, v] in iter(config.dtd))),
                     (["dactyl." + s, config[s]] for each (s in config.dtdStrings)))
                  .map(function ([k, v]) ["<!ENTITY ", k, " '", String.replace(v || "null", /'/g, "&apos;"), "'>"].join(""))
                  .join("\n")]
        });
    },

    loadStyles: function loadStyles() {
        const { highlight } = require("highlight");
        highlight.styleableChrome = this.styleableChrome;
        highlight.loadCSS(this.CSS);
        highlight.loadCSS(this.helpCSS);
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
    },

    get addonID() this.name + "@dactyl.googlecode.com",
    addon: Class.memoize(function () {
        let addon;
        util.waitFor(function () {
            addon = services.fuel.storage.get("dactyl.bootstrap", {}).addon;
            if (addon && !addon.getResourceURI)
                util.reportError(Error("Don't have add-on yet"));

            return !addon || addon.getResourceURI;
        });

        if (!addon)
            addon = require("addons").AddonManager.getAddonByID(this.addonID);
        return addon;
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
            return iter(s.slice(prefix.length).replace(/\/.*/, "") for (s in io.listJar(jar.JARFile, prefix)))
                        .uniq().toArray();
        }
        else {
            return array(f.leafName
                         // Fails on FF3: for (f in util.getFile(uri).iterDirectory())
                         for (f in values(util.getFile(uri).readDirectory()))
                         if (f.isDirectory())).array;
        }
    }),

    /**
     * Returns the best locale match to the current locale from a list
     * of available locales.
     *
     * @param {[string]} list A list of available locales
     * @returns {string}
     */
    bestLocale: function (list) {
        let langs = set(list);
        return values([this.appLocale, this.appLocale.replace(/-.*/, ""),
                       "en", "en-US", iter(langs).next()])
            .nth(function (l) set.has(langs, l), 0);
    },

    haveHg: Class.memoize(function () {
        if (/pre$/.test(this.addon.version)) {
            let uri = this.addon.getResourceURI("../.hg");
            if (uri instanceof Ci.nsIFileURL &&
                    uri.QueryInterface(Ci.nsIFileURL).file.exists() &&
                    io.pathSearch("hg"))
                return ["hg", "-R", uri.file.parent.path];
        }
        return null;
    }),

    branch: Class.memoize(function () {
        if (this.haveHg)
            return io.system(this.haveHg.concat(["branch"])).output;
        return (/pre-hg\d+-(.*)$/.exec(this.version) || [])[1];
    }),

    /** @property {string} The Dactyl version string. */
    version: Class.memoize(function () {
        if (/pre$/.test(this.addon.version)) {
            let uri = this.addon.getResourceURI("../.hg");
            if (uri instanceof Ci.nsIFileURL &&
                    uri.QueryInterface(Ci.nsIFileURL).file.exists() &&
                    io.pathSearch("hg")) {
                return io.system(["hg", "-R", uri.file.parent.path,
                                  "log", "-r.",
                                  "--template=hg{rev}-" + this.branch + " ({date|isodate})"]).output;
            }
        }
        let version = this.addon.version;
        if ("@DATE@" !== "@" + "DATE@")
            version += " (created: @DATE@)";
        return version;
    }),

    dtd: memoize({
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

        "tag.command-line": '<link topic="command-line">command line</link>',
        "tag.status-line":  '<link topic="status-line">status line</link>',
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

    styleHelp: function styleHelp() {
        if (!this.helpStyled) {
            const { highlight } = require("highlight");
            for (let k in keys(highlight.loaded))
                if (/^(Help|StatusLine)|^(Boolean|Indicator|MoreMsg|Number|Logo|Key(word)?|String)$/.test(k))
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
                        <menuitem observes={"pentadactyl-" + id + "Sidebar"} label={name} accesskey={key} xmlns={XUL}/>
                append.XUL::broadcasterset[0].* +=
                        <broadcaster id={"pentadactyl-" + id + "Sidebar"}
                            autoCheck="false" type="checkbox" group="sidebar"
                            sidebartitle={name} sidebarurl={uri}
                            oncommand="toggleSidebar(this.id || this.observes);" xmlns={XUL}/>
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

    commandContainer: "browser-bottombox",

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
     *      as follows:
     *  [0] description - A description of the dialog, used in
     *                    command completion results for :dialog.
     *  [1] action - The function executed by :dialog.
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
     * @property {Object} A map between key names for key events which should be ignored,
     *     and a mask of the modes in which they should be ignored.
     */
    ignoreKeys: {}, // NOTE: be aware you can't put useful values in here, as "modes.NORMAL" etc. are not defined at this time

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
        Boolean      color: red;
        Function     color: navy;
        Null         color: blue;
        Number       color: blue;
        Object       color: maroon;
        String       color: green; white-space: pre;

        Key          font-weight: bold;

        Enabled      color: blue;
        Disabled     color: red;

        FontFixed                            font-family: monospace !important;
        FontCode            font-size: 9pt;  font-family: -mox-fixed, monospace !important;
        FontProportional    font-size: 10pt; font-family: "Droid Sans", "Helvetica LT Std", Helvetica, "DejaVu Sans", Verdana, sans-serif !important;

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

        Normal            color: black   !important; background: white       !important; font-weight: normal !important;
        StatusNormal      color: inherit !important; background: transparent !important;
        ErrorMsg          color: white   !important; background: red         !important; font-weight: bold !important;
        InfoMsg           color: black   !important; background: white       !important;
        StatusInfoMsg     color: inherit !important; background: transparent !important;
        LineNr            color: orange  !important; background: white       !important;
        ModeMsg           color: black   !important; background: white       !important;
        StatusModeMsg     color: inherit !important; background: transparent !important; padding-right: 1em;
        MoreMsg           color: green   !important; background: white       !important;
        StatusMoreMsg                                background: transparent !important;
        Message           white-space: pre-wrap !important; min-width: 100%; width: 100%; padding-left: 4em; text-indent: -4em; display: block;
        Message String    white-space: pre-wrap;
        NonText           color: blue; background: transparent !important;
        *Preview          color: gray;
        Question          color: green   !important; background: white       !important; font-weight: bold !important;
        StatusQuestion    color: green   !important; background: transparent !important;
        WarningMsg        color: red     !important; background: white       !important;
        StatusWarningMsg  color: red     !important; background: transparent !important;

        CmdLine;>*;;FontFixed   padding: 1px !important;
        CmdPrompt;.dactyl-commandline-prompt
        CmdInput;.dactyl-commandline-command
        CmdOutput         white-space: pre;


        CompGroup
        CompGroup:not(:first-of-type)  margin-top: .5em;
        CompGroup:last-of-type         padding-bottom: 1.5ex;

        CompTitle            color: magenta; background: white; font-weight: bold;
        CompTitle>*          padding: 0 .5ex;
        CompTitleSep         height: 1px; background: magenta; background: -moz-linear-gradient(60deg, magenta, white);

        CompMsg              font-style: italic; margin-left: 16px;

        CompItem
        CompItem:nth-child(2n+1)    background: rgba(0, 0, 0, .04);
        CompItem[selected]   background: yellow;
        CompItem>*           padding: 0 .5ex;

        CompIcon             width: 16px; min-width: 16px; display: inline-block; margin-right: .5ex;
        CompIcon>img         max-width: 16px; max-height: 16px; vertical-align: middle;

        CompResult           width: 36%; padding-right: 1%; overflow: hidden;
        CompDesc             color: gray; width: 62%; padding-left: 1em;

        CompLess             text-align: center; height: 0;    line-height: .5ex; padding-top: 1ex;
        CompLess::after      content: "⌃";

        CompMore             text-align: center; height: .5ex; line-height: .5ex; margin-bottom: -.5ex;
        CompMore::after      content: "⌄";


        EditorEditing;;*   background: #bbb !important; -moz-user-input: none; -moz-user-modify: read-only;
        EditorError;;*     background: red !important;
        EditorBlink1;;*    background: yellow !important;
        EditorBlink2;;*

        Indicator   color: blue; width: 1.5em; text-align: center;
        Filter      font-weight: bold;

        Keyword     color: red;
        Tag         color: blue;

        Link                        position: relative; padding-right: 2em;
        Link:not(:hover)>LinkInfo   opacity: 0; left: 0; width: 1px; height: 1px; overflow: hidden;
        LinkInfo                    {
            color: black;
            position: absolute;
            left: 100%;
            padding: 1ex;
            margin: -1ex -1em;
            background: rgba(255, 255, 255, .8);
            border-radius: 1ex;
        }

        StatusLine;;;FontFixed  {
            -moz-appearance: none !important;
            font-weight: bold;
            background: transparent !important;
            border: 0px !important;
            padding-right: 0px !important;
            min-height: 18px !important;
            text-shadow: none !important;
        }
        StatusLineNormal;[dactyl|highlight]    color: white !important; background: black   !important;
        StatusLineBroken;[dactyl|highlight]    color: black !important; background: #FFa0a0 !important; /* light-red */
        StatusLineSecure;[dactyl|highlight]    color: black !important; background: #a0a0FF !important; /* light-blue */
        StatusLineExtended;[dactyl|highlight]  color: black !important; background: #a0FFa0 !important; /* light-green */

        TabClose;.tab-close-button
        TabIcon;.tab-icon       min-width: 16px;
        TabText;.tab-text
        TabNumber               font-weight: bold; margin: 0px; padding-right: .8ex; cursor: default;
        TabIconNumber {
            cursor: default;
            width: 16px;
            margin: 0 2px 0 -18px !important;
            font-weight: bold;
            color: white;
            text-align: center;
            text-shadow: black -1px 0 1px, black 0 1px 1px, black 1px 0 1px, black 0 -1px 1px;
        }

        Title       color: magenta; background: white; font-weight: bold;
        URL         text-decoration: none; color: green; background: inherit;
        URL:hover   text-decoration: underline; cursor: pointer;
        URLExtra    color: gray;

        FrameIndicator;;* {
            background-color: red;
            opacity: 0.5;
            z-index: 999999;
            position: fixed;
            top:      0;
            bottom:   0;
            left:     0;
            right:    0;
        }

        Bell          background-color: black !important;

        Hint;;* {
            font:        bold 10px "Droid Sans Mono", monospace !important;
            margin:      -.2ex;
            padding:     0 0 0 1px;
            outline:     1px solid rgba(0, 0, 0, .5);
            background:  rgba(255, 248, 231, .8);
            color:       black;
        }
        Hint[active];;*  background: rgba(255, 253, 208, .8);
        Hint::after;;*   content: attr(text) !important;
        HintElem;;*      background-color: yellow  !important; color: black !important;
        HintActive;;*    background-color: #88FF00 !important; color: black !important;
        HintImage;;*     opacity: .5 !important;

        Button                  display: inline-block; font-weight: bold; cursor: pointer; color: black; text-decoration: none;
        Button:hover            text-decoration: underline;
        Button[collapsed]       visibility: collapse; width: 0;
        Button::before          content: "["; color: gray; text-decoration: none !important;
        Button::after           content: "]"; color: gray; text-decoration: none !important;
        Button:not([collapsed]) ~ Button:not([collapsed])::before  content: "/[";

        Buttons

        DownloadCell                    display: table-cell; padding: 0 1ex;

        Downloads                       display: table; margin: 0; padding: 0;
        DownloadHead;;;CompTitle        display: table-row;
        DownloadHead>*;;;DownloadCell

        Download                        display: table-row;
        Download:not([active])          color: gray;

        Download>*;;;DownloadCell
        DownloadButtons
        DownloadPercent
        DownloadProgress
        DownloadProgressHave
        DownloadProgressTotal
        DownloadSource
        DownloadState
        DownloadTime
        DownloadTitle
        DownloadTitle>Link>a         max-width: 48ex; overflow: hidden; display: inline-block;

        AddonCell                    display: table-cell; padding: 0 1ex;

        Addons                       display: table; margin: 0; padding: 0;
        AddonHead;;;CompTitle        display: table-row;
        AddonHead>*;;;AddonCell

        Addon                        display: table-row;

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
        Help;;;FontProportional                     line-height: 1.4em;

        HelpArg;;;FontCode                          color: #6A97D4;
        HelpOptionalArg;;;FontCode                  color: #6A97D4;

        HelpBody                                    display: block; margin: 1em auto; max-width: 100ex; padding-bottom: 1em; margin-bottom: 4em; border-bottom-width: 1px;
        HelpBorder;*;dactyl://help/*                border-color: silver; border-width: 0px; border-style: solid;
        HelpCode;;;FontCode                         display: block; white-space: pre; margin-left: 2em;
        HelpTT;html|tt;dactyl://help/*;FontCode

        HelpDefault;;;FontCode                      display: inline-block; margin: -1px 1ex 0 0; white-space: pre; vertical-align: text-top;

        HelpDescription                             display: block; clear: right;
        HelpDescription[short]                      clear: none;
        HelpEm;html|em;dactyl://help/*              font-weight: bold; font-style: normal;

        HelpEx;;;FontCode                           display: inline-block; color: #527BBD;

        HelpExample                                 display: block; margin: 1em 0;
        HelpExample::before                         content: "Example: "; font-weight: bold;

        HelpInfo                                    display: block; width: 20em; margin-left: auto;
        HelpInfoLabel                               display: inline-block; width: 6em;  color: magenta; font-weight: bold; vertical-align: text-top;
        HelpInfoValue                               display: inline-block; width: 14em; text-decoration: none;             vertical-align: text-top;

        HelpItem                                    display: block; margin: 1em 1em 1em 10em; clear: both;

        HelpKey;;;FontCode                          color: #102663;
        HelpKeyword                                 font-weight: bold; color: navy;

        HelpLink;html|a;dactyl://help/*             text-decoration: none !important;
        HelpLink[href]:hover                        text-decoration: underline !important;
        HelpLink[href^="mailto:"]::after            content: "✉"; padding-left: .2em;
        HelpLink[rel=external] {
            /* Thanks, Wikipedia */
            background: transparent url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAMAAAC67D+PAAAAFVBMVEVmmcwzmcyZzP8AZswAZv////////9E6giVAAAAB3RSTlP///////8AGksDRgAAADhJREFUGFcly0ESAEAEA0Ei6/9P3sEcVB8kmrwFyni0bOeyyDpy9JTLEaOhQq7Ongf5FeMhHS/4AVnsAZubxDVmAAAAAElFTkSuQmCC) no-repeat scroll right center;
            padding-right: 13px;
        }


        HelpTOC
        HelpTOC>ol ol                               margin-left: -1em;

        HelpOrderedList;ol;dactyl://help/*                          margin: 1em 0;
        HelpOrderedList1;ol[level="1"],ol;dactyl://help/*           list-style: outside decimal; display: block;
        HelpOrderedList2;ol[level="2"],ol ol;dactyl://help/*        list-style: outside upper-alpha;
        HelpOrderedList3;ol[level="3"],ol ol ol;dactyl://help/*     list-style: outside lower-roman;
        HelpOrderedList4;ol[level="4"],ol ol ol ol;dactyl://help/*  list-style: outside decimal;

        HelpList;html|ul;dactyl://help/*      display: block; list-style-position: outside; margin: 1em 0;
        HelpListItem;html|li;dactyl://help/*  display: list-item;


        HelpNote                                    color: red; font-weight: bold;

        HelpOpt;;;FontCode                          color: #106326;
        HelpOptInfo;;;FontCode                      display: block; margin-bottom: 1ex; padding-left: 4em;

        HelpParagraph;html|p;dactyl://help/*        display: block; margin: 1em 0em;
        HelpParagraph:first-child                   margin-top: 0;
        HelpParagraph:last-child                    margin-bottom: 0;
        HelpSpec;;;FontCode                         display: block; margin-left: -10em; float: left; clear: left; color: #527BBD; margin-right: 1em;

        HelpString;;;FontCode                       color: green; font-weight: normal;
        HelpString::before                          content: '"';
        HelpString::after                           content: '"';
        HelpString[delim]::before                   content: attr(delim);
        HelpString[delim]::after                    content: attr(delim);

        HelpNews        position: relative;
        HelpNewsOld     opacity: .7;
        HelpNewsTag     position: absolute; left: 100%; padding-left: 1em; color: #527BBD; opacity: .6; white-space: pre;

        HelpHead;html|h1,html|h2,html|h3,html|h4;dactyl://help/* {
            font-weight: bold;
            color: #527BBD;
            clear: both;
        }
        HelpHead1;html|h1;dactyl://help/* {
            margin: 2em 0 1em;
            padding-bottom: .2ex;
            border-bottom-width: 1px;
            font-size: 2em;
        }
        HelpHead2;html|h2;dactyl://help/* {
            margin: 2em 0 1em;
            padding-bottom: .2ex;
            border-bottom-width: 1px;
            font-size: 1.2em;
        }
        HelpHead3;html|h3;dactyl://help/* {
            margin: 1em 0;
            padding-bottom: .2ex;
            font-size: 1.1em;
        }
        HelpHead4;html|h4;dactyl://help/* {
        }


        HelpTab;html|dl;dactyl://help/* {
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
        HelpTabTitle;html|dt;dactyl://help/*;FontCode  display: table-cell; padding: .1ex 1ex; font-weight: bold;
        HelpTabDescription;html|dd;dactyl://help/*  display: table-cell; padding: .3ex 1em; text-indent: -1em; border-width: 0px;
        HelpTabDescription>*;;dactyl://help/*       text-indent: 0;
        HelpTabRow;html|dl>html|tr;dactyl://help/*  display: table-row;

        HelpTag;;;FontCode                          display: inline-block; color: #527BBD; margin-left: 1ex; font-weight: normal;
        HelpTags                                    display: block; float: right; clear: right;
        HelpTopic;;;FontCode                        color: #102663;
        HelpType;;;FontCode                         margin-right: 2ex;

        HelpWarning                                 color: red; font-weight: bold;

        HelpXML;;;FontCode                          color: #C5F779; background-color: #444444; font-family: Terminus, Fixed, monospace;
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
});

JSMLoader.loadSubScript("resource://dactyl-local-content/config.js", this);

config.INIT = update(Object.create(config.INIT), config.INIT, {
    init: function init(dactyl, modules, window) {
        init.superapply(this, arguments);

        let img = window.Image();
        img.src = this.logo || "chrome://dactyl-local-content/logo.png";
        img.onload = function () {
            highlight.loadCSS(<>{"!Logo  {"}
                     display:    inline-block;
                     background: url({img.src});
                     width:      {img.width}px;
                     height:     {img.height}px;
                 {"}"}</>);
            img = null;
        };
    },

    load: function load(dactyl, modules, window) {
        load.superapply(this, arguments);

        this.timeout(function () {
            if (this.branch && this.branch !== "default" &&
                    modules.yes_i_know_i_should_not_report_errors_in_these_branches_thanks.indexOf(this.branch) === -1)
                dactyl.warn("You are running " + config.appName + " from a testing branch: " + this.branch + ". " +
                            "Please do not report errors which do not also occur in the default branch.");
        }, 1000);
    }
});

endModule();

} catch(e){ if (typeof e === "string") e = Error(e); dump(e.fileName+":"+e.lineNumber+": "+e+"\n" + e.stack); }

// vim: set fdm=marker sw=4 sts=4 et ft=javascript:
