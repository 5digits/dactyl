// Copyright (c) 2006-2008 by Martin Stubenschrott <stubenschrott@vimperator.org>
// Copyright (c) 2007-2009 by Doug Kearns <dougkearns@gmail.com>
// Copyright (c) 2008-2010 by Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

/** @scope modules */

default xml namespace = XHTML;
XML.ignoreWhitespace = false;
XML.prettyPrinting = false;

const plugins = { __proto__: modules };
const userContext = newContext(modules);

const EVAL_ERROR = "__dactyl_eval_error";
const EVAL_RESULT = "__dactyl_eval_result";
const EVAL_STRING = "__dactyl_eval_string";

function deprecated(reason, fn) {
    let name, func = callable(fn) ? fn : function () this[fn].apply(this, arguments);
    function deprecatedMethod() {
        let frame = Components.stack.caller;
        let obj = this.className || this.constructor.className;
        if (!set.add(deprecatedMethod.seen, frame.filename))
            dactyl.echoerr(
                (frame.filename || "unknown").replace(/^.*? -> /, "") +
                       ":" + frame.lineNumber + ": " +
                (obj ? obj + "." : "") + (fn.name || name) + " is deprecated: " + reason);
        return func.apply(this, arguments);
    }
    deprecatedMethod.seen = { "chrome://dactyl/content/javascript.js": true };
    return callable(fn) ? deprecatedMethod : Class.Property({
        get: function () deprecatedMethod,
        init: function (prop) { name = prop; }
    });
}

const Dactyl = Module("dactyl", {
    init: function () {
        window.dactyl = this;
        // cheap attempt at compatibility
        let prop = { get: deprecated("Please use dactyl instead", function liberator() dactyl) };
        Object.defineProperty(window, "liberator", prop);
        Object.defineProperty(modules, "liberator", prop);
        this.commands = {};
        this.modules = modules;
        this.observers = {};
    },

    /** @property {string} The name of the current user profile. */
    profileName: Class.memoize(function () {
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

    destroy: function () {
        autocommands.trigger("LeavePre", {});
        storage.saveAll();
        dactyl.triggerObserver("shutdown", null);
        util.dump("All dactyl modules destroyed\n");
        autocommands.trigger("Leave", {});
    },

    /**
     * @property {number} The current main mode.
     * @see modes#mainModes
     */
    get mode()      modes.main,
    set mode(value) modes.main = value,

    get menuItems() Dactyl.getMenuItems(),

    /** @property {Element} The currently focused element. */
    get focus() document.commandDispatcher.focusedElement,

    // Global constants
    CURRENT_TAB: [],
    NEW_TAB: [],
    NEW_BACKGROUND_TAB: [],
    NEW_WINDOW: [],

    forceNewTab: false,
    forceNewWindow: false,

    /** @property {string} The Dactyl version string. */
    version: null,

    /**
     * @property {Object} The map of command-line options. These are
     *     specified in the argument to the host application's -{config.name}
     *     option. E.g. $ firefox -pentadactyl '+u=/tmp/rcfile ++noplugin'
     *     Supported options:
     *         +u=RCFILE   Use RCFILE instead of .pentadactylrc.
     *         ++noplugin  Don't load plugins.
     */
    commandLineOptions: {
        /** @property Whether plugin loading should be prevented. */
        noPlugins: false,
        /** @property An RC file to use rather than the default. */
        rcFile: null,
        /** @property An Ex command to run before any initialization is performed. */
        preCommands: null,
        /** @property An Ex command to run after all initialization has been performed. */
        postCommands: null
    },

    registerObserver: function (type, callback, weak) {
        if (!(type in this.observers))
            this.observers[type] = [];
        this.observers[type].push(weak ? Cu.getWeakReference(callback) : { get: function () callback });
    },

    unregisterObserver: function (type, callback) {
        if (type in this.observers)
            this.observers[type] = this.observers[type].filter(function (c) c.get() != callback);
    },

    // TODO: "zoom": if the zoom value of the current buffer changed
    triggerObserver: function (type) {
        let args = Array.slice(arguments, 1);
        if (type in this.observers)
            this.observers[type] = this.observers[type].filter(function (callback) {
                if (callback.get()) {
                    callback.get().apply(null, args);
                    return true;
                }
            });
    },

    /**
     * Triggers the application bell to notify the user of an error. The
     * bell may be either audible or visual depending on the value of the
     * 'visualbell' option.
     */
    beep: function () {
        if (options["visualbell"]) {
            let bell  = document.getElementById("dactyl-bell");
            let strut = document.getElementById("dactyl-bell-strut");
            if (!bell) {
                bell = document.documentElement.insertBefore(
                    util.xmlToDom(<hbox xmlns={XUL} style="display: none" highlight="Bell" id="dactyl-bell"/>, document),
                    document.documentElement.firstChild);
                strut = document.documentElement.appendChild(
                    util.xmlToDom(<hbox xmlns={XUL} style="display: none" highlight="Bell" id="dactyl-bell-strut"/>, document));
            }

            bell.style.height = window.innerHeight + "px";
            strut.style.marginBottom = -window.innerHeight + "px";
            strut.style.display = bell.style.display = "";

            util.timeout(function () { strut.style.display = bell.style.display = "none"; }, 20);
        }
        else {
            let soundService = Cc["@mozilla.org/sound;1"].getService(Ci.nsISound);
            soundService.beep();
        }
    },

    /**
     * Reads a string from the system clipboard.
     *
     * This is same as Firefox's readFromClipboard function, but is needed for
     * apps like Thunderbird which do not provide it.
     *
     * @returns {string}
     */
    clipboardRead: function clipboardRead(getClipboard) {
        let str = null;

        try {
            const clipboard = Cc["@mozilla.org/widget/clipboard;1"].getService(Ci.nsIClipboard);
            const transferable = Cc["@mozilla.org/widget/transferable;1"].createInstance(Ci.nsITransferable);

            transferable.addDataFlavor("text/unicode");

            if (!getClipboard && clipboard.supportsSelectionClipboard())
                clipboard.getData(transferable, clipboard.kSelectionClipboard);
            else
                clipboard.getData(transferable, clipboard.kGlobalClipboard);

            let data = {};
            let dataLen = {};

            transferable.getTransferData("text/unicode", data, dataLen);

            if (data) {
                data = data.value.QueryInterface(Ci.nsISupportsString);
                str = data.data.substring(0, dataLen.value / 2);
            }
        }
        catch (e) {}
        return str;
    },

    /**
     * Copies a string to the system clipboard. If *verbose* is specified the
     * copied string is also echoed to the command line.
     *
     * @param {string} str
     * @param {boolean} verbose
     */
    clipboardWrite: function clipboardWrite(str, verbose) {
        const clipboardHelper = Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper);
        clipboardHelper.copyString(str);

        if (verbose) {
            let message = { message: "Yanked " + str };
            try {
                message.domains = [util.newURI(str).host];
            }
            catch (e) {};
            dactyl.echomsg(message);
        }
    },

    dump: deprecated("Use util.dump instead",
                     function dump() util.dump.apply(util, arguments)),
    dumpStack: deprecated("Use util.dumpStack instead",
                          function dumpStack() util.dumpStack.apply(util, arguments)),

    /**
     * Outputs a plain message to the command line.
     *
     * @param {string} str The message to output.
     * @param {number} flags These control the multi-line message behavior.
     *     See {@link CommandLine#echo}.
     */
    echo: function echo(str, flags) {
        commandline.echo(str, commandline.HL_NORMAL, flags);
    },

    // TODO: Vim replaces unprintable characters in echoerr/echomsg
    /**
     * Outputs an error message to the command line.
     *
     * @param {string} str The message to output.
     * @param {number} flags These control the multi-line message behavior.
     *     See {@link CommandLine#echo}.
     */
    echoerr: function echoerr(str, flags) {
        flags |= commandline.APPEND_TO_MESSAGES;

        if (isinstance(str, ["Error", "Exception"]))
            dactyl.reportError(str);
        if (typeof str == "object" && "echoerr" in str)
            str = str.echoerr;
        else if (isinstance(str, ["Error"]))
            str = str.fileName.replace(/^.*? -> /, "")
                + ":" + str.lineNumber + ": " + str;

        if (options["errorbells"])
            dactyl.beep();

        commandline.echo(str, commandline.HL_ERRORMSG, flags);
    },

    // TODO: add proper level constants
    /**
     * Outputs an information message to the command line.
     *
     * @param {string} str The message to output.
     * @param {number} verbosity The messages log level (0 - 15). Only
     *     messages with verbosity less than or equal to the value of the
     *     *verbosity* option will be output.
     * @param {number} flags These control the multi-line message behavior.
     *     See {@link CommandLine#echo}.
     */
    echomsg: function (str, verbosity, flags) {
        flags |= commandline.APPEND_TO_MESSAGES;

        if (verbosity == null)
            verbosity = 0; // verbosity level is exclusionary

        if (options["verbose"] >= verbosity)
            commandline.echo(str, commandline.HL_INFOMSG, flags);
    },

    /**
     * Loads and executes the script referenced by *uri* in the scope of the
     * *context* object.
     *
     * @param {string} uri The URI of the script to load. Should be a local
     *     chrome:, file:, or resource: URL.
     * @param {Object} context The context object into which the script
     *     should be loaded.
     */
    loadScript: function (uri, context) {
        services.subscriptLoader.loadSubScript(uri, context, File.defaultEncoding);
    },

    userEval: function (str, context, fileName, lineNumber) {
        if (fileName == null)
            if (io.sourcing)
                ({ file: fileName, line: lineNumber }) = io.sourcing;
            else if (String.indexOf(commandline.command, str) > -1)
                [fileName, lineNumber] = ["[Command Line]", 1];

        if (!context)
            context = userContext;
        if (window.isPrototypeOf(modules))
            return Cu.evalInSandbox(str, context, "1.8", fileName, lineNumber);
        return Cu.evalInSandbox("with (window) { with (modules) { this.eval(" + str.quote() + ") } }", context, "1.8", fileName, lineNumber);
    },

    /**
     * Acts like the Function builtin, but the code executes in the
     * userContext global.
     */
    userFunc: function () {
        return this.userEval(
            "(function userFunction(" + Array.slice(arguments, 0, -1).join(", ") + ")" +
            " { " + arguments[arguments.length - 1] + " })");
    },

    /**
     * Execute an Ex command string. E.g. ":zoom 300".
     *
     * @param {string} str The command to execute.
     * @param {Object} modifiers Any modifiers to be passed to
     *     {@link Command#action}.
     * @param {boolean} silent Whether the command should be echoed on the
     *     command line.
     */
    execute: function (str, modifiers, silent) {
        // skip comments and blank lines
        if (/^\s*("|$)/.test(str))
            return;

        modifiers = modifiers || {};

        if (!silent)
            commandline.command = str.replace(/^\s*:\s*/, "");
        let res = true;
        for (let [command, args] in commands.parseCommands(str.replace(/^'(.*)'$/, "$1"))) {
            if (command === null)
                throw FailedAssertion("E492: Not a " + config.appName + " command: " + args.commandString);

            res = res && command.execute(args, modifiers);
        }
        return res;
    },

    /**
     * Focuses the content window.
     *
     * @param {boolean} clearFocusedElement Remove focus from any focused
     *     element.
     */
    focusContent: function (clearFocusedElement) {
        if (window != services.windowWatcher.activeWindow)
            return;

        let win = document.commandDispatcher.focusedWindow;
        let elem = config.mainWidget || window.content;
        // TODO: make more generic
        try {
            if (this.has("mail") && !config.isComposeWindow) {
                let i = gDBView.selection.currentIndex;
                if (i == -1 && gDBView.rowCount >= 0)
                    i = 0;
                gDBView.selection.select(i);
            }
            else {
                let frame = buffer.focusedFrame;
                if (frame && frame.top == window.content && !Editor.getEditor(frame))
                    elem = frame;
            }
        }
        catch (e) {}

        if (clearFocusedElement)
            if (dactyl.focus)
                dactyl.focus.blur();
            else if (win && Editor.getEditor(win)) {
                win.blur();
                if (win.frameElement)
                    win.frameElement.blur();
            }

        if (elem instanceof Window && Editor.getEditor(elem))
            elem = window;

        if (elem && elem != dactyl.focus)
            elem.focus();
    },

    /**
     * Returns whether this Dactyl extension supports *feature*.
     *
     * @param {string} feature The feature name.
     * @returns {boolean}
     */
    has: function (feature) config.features.indexOf(feature) >= 0,

    /**
     * Returns the URL of the specified help *topic* if it exists.
     *
     * @param {string} topic The help topic to lookup.
     * @param {boolean} unchunked Whether to search the unchunked help page.
     * @returns {string}
     */
    findHelp: function (topic, unchunked) {
        if (!unchunked && topic in services["dactyl:"].FILE_MAP)
            return topic;
        unchunked = !!unchunked;
        let items = completion._runCompleter("help", topic, null, unchunked).items;
        let partialMatch = null;

        function format(item) item.description + "#" + encodeURIComponent(item.text);

        for (let [i, item] in Iterator(items)) {
            if (item.text == topic)
                return format(item);
            else if (!partialMatch && topic)
                partialMatch = item;
        }

        if (partialMatch)
            return format(partialMatch);
        return null;
    },

    /**
     * @private
     * Initialize the help system.
     */
    initHelp: function () {
        if (!this.helpInitialized) {
            if ("noscriptOverlay" in window) {
                noscriptOverlay.safeAllow("chrome-data:", true, false);
                noscriptOverlay.safeAllow("dactyl:", true, false);
            }

            let namespaces = [config.name, "dactyl"];
            services["dactyl:"].init({});

            let tagMap = services["dactyl:"].HELP_TAGS;
            let fileMap = services["dactyl:"].FILE_MAP;
            let overlayMap = services["dactyl:"].OVERLAY_MAP;

            // Find help and overlay files with the given name.
            function findHelpFile(file) {
                let result = [];
                for (let [, namespace] in Iterator(namespaces)) {
                    let url = ["chrome://", namespace, "/locale/", file, ".xml"].join("");
                    let res = util.httpGet(url);
                    if (res) {
                        if (res.responseXML.documentElement.localName == "document")
                            fileMap[file] = url;
                        if (res.responseXML.documentElement.localName == "overlay")
                            overlayMap[file] = url;
                        result.push(res.responseXML);
                    }
                }
                return result;
            }
            // Find the tags in the document.
            function addTags(file, doc) {
                for (let elem in util.evaluateXPath("//@tag|//dactyl:tags/text()|//dactyl:tag/text()", doc))
                    for (let tag in array((elem.value || elem.textContent).split(/\s+/)).compact().iterValues())
                        tagMap[tag] = file;
            }

            // Scrape the list of help files from all.xml
            // Manually process main and overlay files, since XSLTProcessor and
            // XMLHttpRequest don't allow access to chrome documents.
            tagMap["all"] = tagMap["all.xml"] = "all";
            let files = findHelpFile("all").map(function (doc)
                    [f.value for (f in util.evaluateXPath("//dactyl:include/@href", doc))]);

            // Scrape the tags from the rest of the help files.
            array.flatten(files).forEach(function (file) {
                tagMap[file + ".xml"] = file;
                findHelpFile(file).forEach(function (doc) {
                    addTags(file, doc);
                });
            });

            // Process plugin help entries.
            XML.ignoreWhiteSpace = false;
            XML.prettyPrinting = false;

            let body = XML();
            for (let [, context] in Iterator(plugins.contexts))
                if (context && context.INFO instanceof XML) {
                    let info = context.INFO;
                    if (info.*.@lang.length()) {
                        let langs = set([String(a) for each (a in info.*.@lang)]);
                        let lang = [window.navigator.language,
                                    window.navigator.language.replace(/-.*/, ""),
                                    "en", "en-US", info.*.@lang[0]
                                   ].filter(function (l) set.has(langs, l))[0];

                        info.* = info.*.(function::attribute("lang").length() == 0 || @lang == lang);

                        for each (let elem in info.NS::info)
                            for each (let attr in ["@name", "@summary", "@href"])
                                if (elem[attr].length())
                                    info[attr] = elem[attr];
                    }
                    body += <h2 xmlns={NS.uri} tag={context.INFO.@name + '-plugin'}>{context.INFO.@summary}</h2> +
                        context.INFO;
                }

            let help =
                '<?xml version="1.0"?>\n' +
                '<?xml-stylesheet type="text/xsl" href="chrome://dactyl/content/help.xsl"?>\n' +
                '<!DOCTYPE document SYSTEM "chrome://dactyl/content/dactyl.dtd">\n' +
                unescape(encodeURI( // UTF-8 handling hack.
                <document xmlns={NS}
                    name="plugins" title={config.appName + " Plugins"}>
                    <h1 tag="using-plugins">Using Plugins</h1>
                    <toc start="2"/>

                    {body}
                </document>.toXMLString()));
            fileMap["plugins"] = function () ['text/xml;charset=UTF-8', help];

            addTags("plugins", util.httpGet("dactyl://help/plugins").responseXML);
            this.helpInitialized = true;
        }
    },
    stringifyXML: function (xml) {
        XML.prettyPrinting = false;
        XML.ignoreWhitespace = false;
        return UTF8(xml.toXMLString());
    },

    exportHelp: function (path) {
        const FILE = io.File(path);
        const PATH = FILE.leafName.replace(/\..*/, "") + "/";
        const TIME = Date.now();

        dactyl.initHelp();
        let zip = services.ZipWriter();
        zip.open(FILE, File.MODE_CREATE | File.MODE_WRONLY | File.MODE_TRUNCATE);
        function addURIEntry(file, uri)
            zip.addEntryChannel(PATH + file, TIME, 9,
                services.io.newChannel(uri, null, null), false);
        function addDataEntry(file, data) // Unideal to an extreme.
            addURIEntry(file, "data:text/plain;charset=UTF-8," + encodeURI(data));

        let empty = set("area base basefont br col frame hr img input isindex link meta param"
                            .split(" "));

        let chrome = {};
        let styles = {};
        for (let [file, ] in Iterator(services["dactyl:"].FILE_MAP)) {
            dactyl.open("dactyl://help/" + file);
            dactyl.modules.events.waitForPageLoad();
            let data = [
                '<?xml version="1.0" encoding="UTF-8"?>\n',
                '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN"\n',
                '          "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">\n'
            ];
            function fix(node) {
                switch(node.nodeType) {
                    case Node.ELEMENT_NODE:
                        if (isinstance(node, [HTMLBaseElement, HTMLScriptElement]))
                            return;

                        data.push("<"); data.push(node.localName);
                        if (node instanceof HTMLHtmlElement)
                            data.push(" xmlns=" + XHTML.uri.quote());

                        for (let { name, value } in array.iterValues(node.attributes)) {
                            if (name == "dactyl:highlight") {
                                name = "class";
                                value = "hl-" + value;
                                set.add(styles, value);
                            }
                            if (name == "href") {
                                value = node.href;
                                if (value.indexOf("dactyl://help-tag/") == 0) {
                                    let uri = services.io.newChannel(value, null, null).originalURI;
                                    value = uri.spec == value ? "javascript:;" : uri.path.substr(1);
                                }
                                if (!/^#|[\/](#|$)|^[a-z]+:/.test(value))
                                    value = value.replace(/(#|$)/, ".xhtml$1");
                            }
                            if (name == "src" && value.indexOf(":") > 0) {
                                chrome[value] = value.replace(/.*\//, "");;
                                value = value.replace(/.*\//, "");
                            }
                            data.push(" ");
                            data.push(name);
                            data.push('="');
                            data.push(<>{value}</>.toXMLString());
                            data.push('"');
                        }
                        if (node.localName in empty)
                            data.push(" />");
                        else {
                            data.push(">");
                            if (node instanceof HTMLHeadElement)
                                data.push(<link rel="stylesheet" type="text/css" href="help.css"/>.toXMLString());
                            Array.map(node.childNodes, fix);
                            data.push("</"); data.push(node.localName); data.push(">");
                        }
                        break;
                    case Node.TEXT_NODE:
                        data.push(<>{node.textContent}</>.toXMLString());
                }
            }
            fix(window.content.document.documentElement);
            addDataEntry(file + ".xhtml", data.join(""));
        }

        let data = [h for (h in highlight) if (set.has(styles, h.class) || /^Help/.test(h.class))]
            .map(function (h)
                 h.selector.replace(/^\[.*?=(.*?)\]/, ".hl-$1").replace(/html\|/, "") + "\t" +
                     "{" + h.value + "}")
            .join("\n");
        addDataEntry("help.css", data.replace(/chrome:[^ ")]+\//g, ""));

        let m, re = /(chrome:[^ ");]+\/)([^ ");]+)/g;
        while ((m = re.exec(data)))
            chrome[m[0]] = m[2];

        for (let [uri, leaf] in Iterator(chrome))
            addURIEntry(leaf, uri);

        zip.close();
    },

    /**
     * Generates a help entry and writes it to the clipboard.
     *
     * @param {Command|Map|Option} obj A dactyl *Command*, *Map* or *Option*
     *     object
     * @param {XMLList} extraHelp Extra help text beyond the description.
     * @returns {string}
     */
    generateHelp: function generateHelp(obj, extraHelp, str) {
        default xml namespace = "";

        let link, tag, spec;
        link = tag = spec = util.identity;
        let args = null;

        if (obj instanceof Command) {
            tag = spec = function (cmd) <>:{cmd}</>;
            link = function (cmd) <ex>:{cmd}</ex>;
            args = obj.parseArgs("", CompletionContext(str || ""));
        }
        else if (obj instanceof Map && obj.count) {
            spec = function (map) <><oa>count</oa>{map}</>;
            link = function (map) let (res = /^<(.*?)>(.*?)/.exec(map))
                res ? <k name={res[1]}>{res[2]}</k> : <k>{map}</k>;
        }
        else if (obj instanceof Option) {
            tag = spec = function (opt) <>'{opt}'</>;
            link = function (opt) <o>{opt}</o>;
        }

        XML.prettyPrinting = false;
        XML.ignoreWhitespace = false;

        // E4X has its warts.
        let br = <>
                    </>;

        let res = <res>
                <dt>{link(obj.name)}</dt> <dd>{obj.description ? obj.description.replace(/\.$/, "") : ""}</dd>
            <item>
                <tags>{template.map(obj.names.reverse, tag, " ")}</tags>
                <spec>{spec((obj.specs || obj.names)[0])}</spec>{
                !obj.type ? "" : <>
                <type>{obj.type}</type>
                <default>{obj.stringDefaultValue}</default></>}
                <description>{
                    obj.description ? br + <p>{obj.description.replace(/\.?$/, ".")}</p> : "" }{
                        extraHelp ? br + extraHelp : "" }{
                        !(extraHelp || obj.description) ? br + <p>Sorry, no help available.</p> : "" }
                </description>
            </item></res>;

        function add(ary) {
            res.item.description.* += br +
                let (br = br + <>    </>)
                    <><dl>{ br + template.map(ary, function ([a, b]) <><dt>{a}</dt> <dd>{b}</dd></>, br) }
                    </dl>
                </>;
        }

        if (obj.completer)
            add(completion._runCompleter(obj.completer, "", null, args).items
                          .map(function (i) [i.text, i.description]));

        if (obj.options && obj.options.some(function (o) o.description))
            add(obj.options.filter(function (o) o.description)
                   .map(function (o) [
                        o.names[0],
                        <>{o.description}{
                            o.names.length == 1 ? "" :
                                <> (short name: {
                                    template.map(o.names.slice(1), function (n) <em>{n}</em>, <>, </>)
                                })</>
                        }</>
                    ]));
        return res.*.toXMLString().replace(/^ {12}/gm, "");;
    },

    /**
     * Opens the help page containing the specified *topic* if it exists.
     *
     * @param {string} topic The help topic to open.
     * @param {boolean} unchunked Whether to use the unchunked help page.
     * @returns {string}
     */
    help: function (topic, unchunked) {
        dactyl.initHelp();
        if (!topic) {
            let helpFile = unchunked ? "all" : options["helpfile"];

            if (helpFile in services["dactyl:"].FILE_MAP)
                dactyl.open("dactyl://help/" + helpFile, { from: "help" });
            else
                dactyl.echomsg("Sorry, help file " + helpFile.quote() + " not found");
            return;
        }

        let page = this.findHelp(topic, unchunked);
        dactyl.assert(page != null, "E149: Sorry, no help for " + topic);

        dactyl.open("dactyl://help/" + page, { from: "help" });
    },

    /**
     * The map of global variables.
     *
     * These are set and accessed with the "g:" prefix.
     */
    _globalVariables: {},
    globalVariables: Class.Property({
        get: deprecated("Please use the options system instead",
            function globalVariables() this._globalVariables)
    }),

    loadPlugins: function () {
        function sourceDirectory(dir) {
            dactyl.assert(dir.isReadable(), "E484: Can't open file " + dir.path);

            dactyl.log("Sourcing plugin directory: " + dir.path + "...", 3);
            let loadplugins = options.get("loadplugins");
            dir.readDirectory(true).forEach(function (file) {
                if (file.isFile() && loadplugins.getKey(file.path) && !(file.path in dactyl.pluginFiles)) {
                    try {
                        io.source(file.path, false);
                        dactyl.pluginFiles[file.path] = true;
                    }
                    catch (e) {
                        dactyl.reportError(e);
                    }
                }
                else if (file.isDirectory())
                    sourceDirectory(file);
            });
        }

        let dirs = io.getRuntimeDirectories("plugins");

        if (dirs.length == 0) {
            dactyl.log("No user plugin directory found", 3);
            return;
        }

        dactyl.echomsg('Searching for "plugins/**/*.{js,' + config.fileExtension + '}" in '
                            + [dir.path.replace(/.plugins$/, "") for ([, dir] in Iterator(dirs))]
                                .join(",").quote(), 2);

        dirs.forEach(function (dir) {
            dactyl.echomsg("Searching for " + (dir.path + "/**/*.{js," + config.fileExtension + "}").quote(), 3);
            sourceDirectory(dir);
        });
    },

    // TODO: add proper level constants
    /**
     * Logs a message to the JavaScript error console. Each message has an
     * associated log level. Only messages with a log level less than or equal
     * to *level* will be printed. If *msg* is an object, it is pretty printed.
     *
     * @param {string|Object} msg The message to print.
     * @param {number} level The logging level 0 - 15.
     */
    log: function (msg, level) {
        let verbose = prefs.get("extensions.dactyl.loglevel", 0);

        if (!level || level <= verbose) {
            if (isObject(msg))
                msg = util.objectToString(msg, false);

            services.console.logStringMessage(config.name + ": " + msg);
        }
    },

    /**
     * Opens one or more URLs. Returns true when load was initiated, or
     * false on error.
     *
     * @param {string|Array} urls A representation of the URLs to open. May be
     *     either a string, which will be passed to
     *     {@see Dactyl#parseURLs}, or an array in the same format as
     *     would be returned by the same.
     * @param {object} params A set of parameters specifying how to open the
     *     URLs. The following properties are recognized:
     *
     *      • background   If true, new tabs are opened in the background.
     *
     *      • from         The designation of the opener, as appears in
     *                     'activate' and 'newtab' options. If present,
     *                     the newtab option provides the default 'where'
     *                     parameter, and the value of the 'activate'
     *                     parameter is inverted if 'background' is true.
     *
     *      • where        One of CURRENT_TAB, NEW_TAB, or NEW_WINDOW
     *
     *      As a deprecated special case, the where parameter may be provided
     *      by itself, in which case it is transformed into { where: params }.
     *
     * @param {boolean} force Don't prompt whether to open more than 20
     *     tabs.
     * @returns {boolean}
     */
    open: function (urls, params, force) {
        if (typeof urls == "string")
            urls = dactyl.parseURLs(urls);

        if (urls.length > 20 && !force)
            return commandline.input("This will open " + urls.length + " new tabs. Would you like to continue? (yes/[no]) ",
                function (resp) {
                    if (resp && resp.match(/^y(es)?$/i))
                        dactyl.open(urls, params, true);
                });

        params = params || {};
        if (isArray(params))
            params = { where: params };

        let flags = 0;
        for (let [opt, flag] in Iterator({ replace: "REPLACE_HISTORY", hide: "BYPASS_HISTORY" }))
            flags |= params[opt] && Ci.nsIWebNavigation["LOAD_FLAGS_" + flag];

        let where = params.where || dactyl.CURRENT_TAB;
        let background = ("background" in params) ? params.background
                                                  : params.where == dactyl.NEW_BACKGROUND_TAB;

        if (params.from && dactyl.has("tabs")) {
            if (!params.where && options.get("newtab").has(params.from))
                where = dactyl.NEW_TAB;
            background ^= !options.get("activate").has(params.from);
        }

        if (urls.length == 0)
            return;

        let browser = config.browser;
        function open(urls, where) {
            try {
                let url = Array.concat(urls)[0];
                let postdata = Array.concat(urls)[1];

                // decide where to load the first url
                switch (where) {
                case dactyl.CURRENT_TAB:
                    browser.loadURIWithFlags(url, flags, null, null, postdata);
                    break;

                case dactyl.NEW_TAB:
                    if (!dactyl.has("tabs"))
                        return open(urls, dactyl.NEW_WINDOW);

                    prefs.withContext(function () {
                        prefs.set("browser.tabs.loadInBackground", true);
                        browser.loadOneTab(url, null, null, postdata, background);
                    });
                    break;

                case dactyl.NEW_WINDOW:
                    window.open();
                    let win = services.windowMediator.getMostRecentWindow("navigator:browser");
                    win.loadURI(url, null, postdata);
                    browser = win.getBrowser();
                    break;
                }
            }
            catch (e) {}
            // Unfortunately, failed page loads throw exceptions and
            // cause a lot of unwanted noise. This solution means that
            // any genuine errors go unreported.
        }

        if (dactyl.forceNewTab)
            where = dactyl.NEW_TAB;
        else if (dactyl.forceNewWindow)
            where = dactyl.NEW_WINDOW;
        else if (!where)
            where = dactyl.CURRENT_TAB;

        for (let [, url] in Iterator(urls)) {
            open(url, where);
            where = dactyl.NEW_TAB;
            background = true;
        }
    },

    pluginFiles: {},

    get plugins() plugins,

    /**
     * Quit the host application, no matter how many tabs/windows are open.
     *
     * @param {boolean} saveSession If true the current session will be
     *     saved and restored when the host application is restarted.
     * @param {boolean} force Forcibly quit irrespective of whether all
     *    windows could be closed individually.
     */
    quit: function (saveSession, force) {
        if (!force &&
            prefs.withContext(function () {
                prefs.set("browser.warnOnQuit", false);
                return !canQuitApplication();
            }))
            return;

        let pref = "browser.startup.page";
        prefs.save(pref);
        if (saveSession)
            prefs.safeSet(pref, 3);
        if (!saveSession && prefs.get(pref) >= 2)
            prefs.safeSet(pref, 1);

        services.appStartup.quit(Ci.nsIAppStartup[force ? "eForceQuit" : "eAttemptQuit"]);
    },

    /**
     * Returns an array of URLs parsed from *str*.
     *
     * Given a string like 'google bla, www.osnews.com' return an array
     * ['www.google.com/search?q=bla', 'www.osnews.com']
     *
     * @param {string} str
     * @returns {string[]}
     */
    stringToURLArray: deprecated("Please use dactyl.parseURLs instead", "parseURLs"),
    parseURLs: function parseURLs(str) {
        let urls;

        if (options["urlseparator"])
            urls = util.splitLiteral(str, RegExp("\\s*" + options["urlseparator"] + "\\s*"));
        else
            urls = [str];

        return urls.map(function (url) {
            if (/^(\.{0,2}|~)(\/|$)/.test(url)) {
                try {
                    // Try to find a matching file.
                    let file = io.File(url);
                    if (file.exists() && file.isReadable())
                        return services.io.newFileURI(file).spec;
                }
                catch (e) {}
            }

            // strip each 'URL' - makes things simpler later on
            url = url.trim();

            // Look for a valid protocol
            let proto = url.match(/^([-\w]+):/);
            if (proto && Cc["@mozilla.org/network/protocol;1?name=" + proto[1]])
                // Handle as URL, but remove spaces. Useful for copied/'p'asted URLs.
                return url.replace(/\s*\n+\s*/g, "");

            // Ok, not a valid proto. If it looks like URL-ish (foo.com/bar),
            // let Gecko figure it out.
            if (/^[a-zA-Z0-9-.]+(?:\/|$)/.test(url) && /[.\/]/.test(url) && !/\s/.test(url) || /^[a-zA-Z0-9-.]+:\d+(?:\/|$)/.test(url))
                return url;

            // TODO: it would be clearer if the appropriate call to
            // getSearchURL was made based on whether or not the first word was
            // indeed an SE alias rather than seeing if getSearchURL can
            // process the call usefully and trying again if it fails

            // check for a search engine match in the string, then try to
            // search for the whole string in the default engine
            let searchURL = bookmarks.getSearchURL(url, false) || bookmarks.getSearchURL(url, true);
            if (searchURL)
                return searchURL;

            // Hmm. No defsearch? Let the host app deal with it, then.
            return url;
        });
    },

    get assert() util.assert,

    /**
     * Traps errors in the called function, possibly reporting them.
     *
     * @param {function} func The function to call
     * @param {object} self The 'this' object for the function.
     */
    trapErrors: function trapErrors(func, self) {
        try {
            return func.apply(self || this, Array.slice(arguments, 2));
        }
        catch (e) {
            dactyl.reportError(e, true);
            return e;
        }
    },

    /**
     * Reports an error to both the console and the host application's
     * Error Console.
     *
     * @param {Object} error The error object.
     */
    reportError: function reportError(error, echo) {
        if (error instanceof FailedAssertion || error.message === "Interrupted") {
            if (error.message)
                dactyl.echoerr(error.message);
            else
                dactyl.beep();
            return;
        }
        if (error.result == Cr.NS_BINDING_ABORTED)
            return;
        if (echo)
            dactyl.echoerr(error);
        util.reportError(error);
    },

    /**
     * Restart the host application.
     */
    restart: function () {
        if (!canQuitApplication())
            return;

        services.appStartup.quit(Ci.nsIAppStartup.eAttemptQuit | Ci.nsIAppStartup.eRestart);
    },

    /**
     * Parses a Dactyl command-line string i.e. the value of the
     * -dactyl command-line option.
     *
     * @param {string} cmdline The string to parse for command-line
     *     options.
     * @returns {Object}
     * @see Commands#parseArgs
     */
    parseCommandLine: function (cmdline) {
        const options = [
            [["+u"], CommandOption.STRING],
            [["++noplugin"], CommandOption.NOARG],
            [["++cmd"], CommandOption.STRING, null, null, true],
            [["+c"], CommandOption.STRING, null, null, true]
        ].map(CommandOption.fromArray, CommandOption);
        try {
            return commands.parseArgs(cmdline, { options: options, argCount: "*" });
        }
        catch (e) {
            dactyl.reportError(e, true);
            return [];
        }
    },

    wrapCallback: function (callback, self) {
        self = self || this;
        let save = ["forceNewTab", "forceNewWindow"];
        let saved = save.map(function (p) dactyl[p]);
        return function wrappedCallback() {
            let vals = save.map(function (p) dactyl[p]);
            saved.forEach(function (p, i) dactyl[save[i]] = p);
            try {
                return callback.apply(self, arguments);
            }
            catch (e) {
                dactyl.reportError(e, true);
            }
            finally {
                vals.forEach(function (p, i) dactyl[save[i]] = p);
            }
        }
    },

    /**
     * @property {Window[]} Returns an array of all the host application's
     *     open windows.
     */
    get windows() [win for (win in iter(services.windowMediator.getEnumerator("navigator:browser")))],

}, {
    // initially hide all GUI elements, they are later restored unless the user
    // has :set go= or something similar in his config
    hideGUI: function () {
        let guioptions = config.guioptions;
        for (let option in guioptions) {
            guioptions[option].forEach(function (elem) {
                try {
                    document.getElementById(elem).collapsed = true;
                }
                catch (e) {}
            });
        }
    },

    // TODO: move this
    getMenuItems: function () {
        function addChildren(node, parent) {
            for (let [, item] in Iterator(node.childNodes)) {
                if (item.childNodes.length == 0 && item.localName == "menuitem"
                    && !/rdf:http:/.test(item.getAttribute("label"))) { // FIXME
                    item.fullMenuPath = parent + item.getAttribute("label");
                    items.push(item);
                }
                else {
                    let path = parent;
                    if (item.localName == "menu")
                        path += item.getAttribute("label") + ".";
                    addChildren(item, path);
                }
            }
        }

        let items = [];
        addChildren(document.getElementById(config.guioptions["m"][1]), "");
        return items;
    },

    // show a usage index either in the MOW or as a full help page
    showHelpIndex: function (tag, items, inMow) {
        if (inMow)
            dactyl.echo(template.usage(items), commandline.FORCE_MULTILINE);
        else
            dactyl.help(tag);
    }
}, {
    // Only general options are added here, which are valid for all Dactyl extensions
    options: function () {
        options.add(["errorbells", "eb"],
            "Ring the bell when an error message is displayed",
            "boolean", false);

        options.add(["exrc", "ex"],
            "Allow reading of an RC file in the current directory",
            "boolean", false);

        options.add(["fullscreen", "fs"],
            "Show the current window fullscreen",
            "boolean", false, {
                setter: function (value) window.fullScreen = value,
                getter: function () window.fullScreen
            });

        const groups = [
            {
                opts: {
                    c: ["Always show the command line, even when empty"],
                    C: ["Always show the command line outside of the status line"],
                    M: ["Always show messages outside of the status line"]
                },
                setter: function (opts) {
                    commandline.widgets.updateVisibility();
                }
            },
            {
                opts: update({
                    s: ["Status bar", [statusline.statusBar.id]]
                }, config.guioptions),
                setter: function (opts) {
                    for (let [opt, [, ids]] in Iterator(this.opts)) {
                        ids.map(function (id) document.getElementById(id))
                           .forEach(function (elem) {
                            if (elem)
                                elem.collapsed = (opts.indexOf(opt) == -1);
                        });
                    }
                }
            },
            {
                opts: {
                    r: ["Right Scrollbar", "vertical"],
                    l: ["Left Scrollbar", "vertical"],
                    b: ["Bottom Scrollbar", "horizontal"]
                },
                setter: function (opts) {
                    let dir = ["horizontal", "vertical"].filter(
                        function (dir) !Array.some(opts,
                            function (o) this.opts[o] && this.opts[o][1] == dir, this),
                        this);
                    let class_ = dir.map(function (dir) "html|html > xul|scrollbar[orient=" + dir + "]");

                    styles.addSheet(true, "scrollbar", "*",
                            class_.length ? class_.join(", ") + " { visibility: collapse !important; }" : "",
                            true);

                    prefs.safeSet("layout.scrollbar.side", opts.indexOf("l") >= 0 ? 3 : 2,
                                  "See 'guioptions' scrollbar flags.");
                },
                validator: function (opts) Option.validIf(!(opts.indexOf("l") >= 0 && opts.indexOf("r") >= 0),
                                                          UTF8("Only one of ‘l’ or ‘r’ allowed"))
            },
            {
                feature: "tabs",
                opts: {
                    n: ["Tab number", highlight.selector("TabNumber")],
                    N: ["Tab number over icon", highlight.selector("TabIconNumber")]
                },
                setter: function (opts) {
                    let classes = [v[1] for ([k, v] in Iterator(this.opts)) if (opts.indexOf(k) < 0)];

                    styles.addSheet(true, "taboptions", "chrome://*",
                        classes.length ? classes.join(",") + "{ display: none; }" : "");

                    tabs.tabBinding.enabled = Array.some(opts, function (k) k in this.opts, this);
                    statusline.updateTabCount();
                }
            }
        ].filter(function (group) !group.feature || dactyl.has(group.feature));

        options.add(["guioptions", "go"],
            "Show or hide certain GUI elements like the menu or toolbar",
            "charlist", config.defaults.guioptions || "", {
                completer: function (context)
                    array(groups).map(function (g) [[k, v[0]] for ([k, v] in Iterator(g.opts))]).flatten(),
                setter: function (value) {
                    for (let group in values(groups))
                        group.setter(value);
                    events.checkFocus();
                    return value;
                },
                validator: function (val) Option.validateCompleter.call(this, val) &&
                        groups.every(function (g) !g.validator || g.validator(val))
            });

        options.add(["helpfile", "hf"],
            "Name of the main help file",
            "string", "intro");

        options.add(["loadplugins", "lpl"],
            "A regexp list that defines which plugins are loaded at startup and via :loadplugins",
            "regexplist", "'\\.(js|" + config.fileExtension + ")$'");

        options.add(["titlestring"],
            "Change the title of the window",
            "string", config.defaults.titlestring || config.host,
            {
                setter: function (value) {
                    let win = document.documentElement;
                    function updateTitle(old, current) {
                        document.title = document.title.replace(RegExp("(.*)" + util.escapeRegexp(old)), "$1" + current);
                    }

                    // TODO: remove this FF3.5 test when we no longer support 3.0
                    //     : make this a config feature
                    if (services.privateBrowsing) {
                        let oldValue = win.getAttribute("titlemodifier_normal");
                        let suffix = win.getAttribute("titlemodifier_privatebrowsing").substr(oldValue.length);

                        win.setAttribute("titlemodifier_normal", value);
                        win.setAttribute("titlemodifier_privatebrowsing", value + suffix);

                        if (services.privateBrowsing.privateBrowsingEnabled) {
                            updateTitle(oldValue + suffix, value + suffix);
                            return value;
                        }
                    }

                    updateTitle(win.getAttribute("titlemodifier"), value);
                    win.setAttribute("titlemodifier", value);

                    return value;
                }
            });

        options.add(["urlseparator", "urlsep", "us"],
            "Set the separator regexp used to separate multiple URL args",
            "string", "\\|");

        options.add(["verbose", "vbs"],
            "Define which info messages are displayed",
            "number", 1,
            { validator: function (value) Option.validIf(value >= 0 && value <= 15, "Value must be between 0 and 15") });

        options.add(["visualbell", "vb"],
            "Use visual bell instead of beeping on errors",
            "boolean", false,
            {
                setter: function (value) {
                    prefs.safeSet("accessibility.typeaheadfind.enablesound", !value,
                                  "See 'visualbell' option");
                    return value;
                }
            });
    },

    mappings: function () {
        mappings.add(modes.all, ["<F1>"],
            "Open the help page",
            function () { dactyl.help(); });

        if (dactyl.has("session"))
            mappings.add([modes.NORMAL], ["ZQ"],
                "Quit and don't save the session",
                function () { dactyl.quit(false); });

        mappings.add([modes.NORMAL], ["ZZ"],
            "Quit and save the session",
            function () { dactyl.quit(true); });
    },

    commands: function () {
        commands.add(["addo[ns]"],
            "Manage available Extensions and Themes",
            function () {
                dactyl.open("chrome://mozapps/content/extensions/extensions.xul",
                    { from: "addons" });
            },
            { argCount: "0" });

        commands.add(["dia[log]"],
            "Open a " + config.appName + " dialog",
            function (args) {
                let dialog = args[0];

                dactyl.assert(dialog in config.dialogs, "E475: Invalid argument: " + dialog);
                dactyl.assert(!config.dialogs[dialog][2] || config.dialogs[dialog][2](),
                              "Dialog " + dialog + " not available");
                try {
                    config.dialogs[dialog][1]();
                }
                catch (e) {
                    dactyl.echoerr("Error opening " + dialog.quote() + ": " + (e.message || e));
                }
            }, {
                argCount: "1",
                bang: true,
                completer: function (context) {
                    context.ignoreCase = true;
                    return completion.dialog(context);
                }
            });

        commands.add(["em[enu]"],
            "Execute the specified menu item from the command line",
            function (args) {
                let arg = args[0] || "";
                let items = Dactyl.getMenuItems();

                dactyl.assert(items.some(function (i) i.fullMenuPath == arg),
                    "E334: Menu not found: " + arg);

                for (let [, item] in Iterator(items)) {
                    if (item.fullMenuPath == arg)
                        item.doCommand();
                }
            }, {
                argCount: "1",
                completer: function (context) completion.menuItem(context),
                literal: 0
            });

        commands.add(["exe[cute]"],
            "Execute the argument as an Ex command",
            function (args) {
                try {
                    let cmd = dactyl.userEval(args[0] || "");
                    dactyl.execute(cmd, null, true);
                }
                catch (e) {
                    dactyl.echoerr(e);
                }
            }, {
                completer: function (context) completion.javascript(context),
                literal: 0
            });

        ///////////////////////////////////////////////////////////////////////////

        if (typeof AddonManager == "undefined")
            modules.AddonManager = {
                getAddonByID: function (id, callback) {
                    callback = callback || util.identity;
                    let addon = id;
                    if (!isObject(addon))
                        addon = services.extensionManager.getItemForID(id);
                    if (!addon)
                        return callback(null);
                    addon = Object.create(addon);

                    function getRdfProperty(item, property) {
                        let resource = services.rdf.GetResource("urn:mozilla:item:" + item.id);
                        let value = "";

                        if (resource) {
                            let target = services.extensionManager.datasource.GetTarget(resource,
                                services.rdf.GetResource("http://www.mozilla.org/2004/em-rdf#" + property), true);
                            if (target && target instanceof Ci.nsIRDFLiteral)
                                value = target.Value;
                        }

                        return value;
                    }

                    ["aboutURL", "creator", "description", "developers",
                     "homepageURL", "iconURL", "installDate", "name",
                     "optionsURL", "releaseNotesURI", "updateDate", "version"].forEach(function (item) {
                        addon[item] = getRdfProperty(addon, item);
                    });
                    addon.isActive = getRdfProperty(addon, "isDisabled") != "true";

                    addon.uninstall = function () {
                        services.extensionManager.uninstallItem(this.id);
                    };
                    addon.appDisabled = false;
                    addon.__defineGetter__("userDisabled", function () getRdfProperty(addon, "userDisabled") === "true");
                    addon.__defineSetter__("userDisabled", function (val) {
                        services.extensionManager[val ? "disableItem" : "enableItem"](this.id);
                    });

                    return callback(addon);
                },
                getAddonsByTypes: function (types, callback) {
                    let res = [];
                    for (let [, type] in Iterator(types))
                        for (let [, item] in Iterator(services.extensionManager
                                    .getItemList(Ci.nsIUpdateItem["TYPE_" + type.toUpperCase()], {})))
                            res.push(this.getAddonByID(item));
                    callback(res);
                },
                getInstallForFile: function (file, callback, mimetype) {
                    callback({
                        addListener: function () {},
                        install: function () {
                            services.extensionManager.installItemFromFile(file, "app-profile");
                        }
                    });
                },
                getInstallForURL: function (url, callback, mimetype) {
                    dactyl.assert(false, "Install by URL not implemented");
                },
            };

        const addonErrors = array.toObject([
            [AddonManager.ERROR_NETWORK_FAILURE, "A network error occurred"],
            [AddonManager.ERROR_INCORRECT_HASH,  "The downloaded file did not match the expected hash"],
            [AddonManager.ERROR_CORRUPT_FILE,    "The file appears to be corrupt"],
            [AddonManager.ERROR_FILE_ACCESS,     "There was an error accessing the filesystem"]]);

        function listener(action, event)
            function addonListener(install) {
                dactyl[install.error ? "echoerr" : "echomsg"](
                    "Add-on " + action + " " + event + ": " + (install.name || install.sourceURI.spec) +
                    (install.error ? ": " + addonErrors[install.error] : ""));
            }
        const addonListener = {
            onNewInstall:      function (install) {},
            onExternalInstall: function (addon, existingAddon, needsRestart) {},
            onDownloadStarted:   listener("download", "started"),
            onDownloadEnded:     listener("download", "complete"),
            onDownloadCancelled: listener("download", "cancelled"),
            onDownloadFailed:    listener("download", "failed"),
            onDownloadProgress:  function (install) {},
            onInstallStarted:   function (install) {},
            onInstallEnded:     listener("installation", "complete"),
            onInstallCancelled: listener("installation", "cancelled"),
            onInstallFailed:    listener("installation", "failed")
        };

        const updateAddons = Class("UpgradeListener", {
            init: function init(addons) {
                dactyl.assert(!addons.length || addons[0].findUpdates,
                              "Not available on " + config.host + " " + services.runtime.version);
                this.remaining = addons;
                this.upgrade = [];
                dactyl.echomsg("Checking updates for addons: " + addons.map(function (a) a.name).join(", "));
                for (let addon in values(addons))
                    addon.findUpdates(this, AddonManager.UPDATE_WHEN_USER_REQUESTED, null, null);
            },
            addonListener: {
                __proto__: addonListener,
                onDownloadStarted: function () {},
                onDownloadEnded: function () {}
            },
            onUpdateAvailable: function (addon, install) {
                this.upgrade.push(addon);
                install.addListener(this.addonListener);
                install.install();
            },
            onUpdateFinished: function (addon, error) {
                this.remaining = this.remaining.filter(function (a) a != addon);
                if (!this.remaining.length)
                    dactyl.echomsg(
                        this.upgrade.length
                            ? "Installing updates for addons: " + this.upgrade.map(function (i) i.name).join(", ")
                            : "No addon updates found");
            }
        });

        ///////////////////////////////////////////////////////////////////////////

        function callResult(method) {
            let args = Array.slice(arguments, 1);
            return function (result) { result[method].apply(result, args); };
        }

        commands.add(["exta[dd]"],
            "Install an extension",
            function (args) {
                let url  = args[0];
                let file = io.File(url);
                function install(addonInstall) {
                    addonInstall.addListener(addonListener);
                    addonInstall.install();
                }

                if (!file.exists())
                    AddonManager.getInstallForURL(url,   install, "application/x-xpinstall");
                else if (file.isReadable() && file.isFile())
                    AddonManager.getInstallForFile(file, install, "application/x-xpinstall");
                else if (file.isDirectory())
                    dactyl.echomsg("Cannot install a directory: " + file.path.quote(), 0);
                else
                    dactyl.echoerr("E484: Can't open file " + file.path);
            }, {
                argCount: "1",
                completer: function (context) {
                    context.filters.push(function ({ item }) item.isDirectory() || /\.xpi$/.test(item.leafName));
                    completion.file(context);
                },
                literal: 0
            });

        // TODO: handle extension dependencies
        [
            {
                name: "extde[lete]",
                description: "Uninstall an extension",
                action: callResult("uninstall"),
                perm: "uninstall"
            },
            {
                name: "exte[nable]",
                description: "Enable an extension",
                action: function (addon) addon.userDisabled = false,
                filter: function ({ item }) item.userDisabled,
                perm: "enable"
            },
            {
                name: "extd[isable]",
                description: "Disable an extension",
                action: function (addon) addon.userDisabled = true,
                filter: function ({ item }) !item.userDisabled,
                perm: "disable"
            },
            {
                name: "extu[pdate]",
                description: "Update an extension",
                actions: updateAddons,
                filter: function ({ item }) !item.userDisabled,
                perm: "upgrade"
            }
        ].forEach(function (command) {
            let perm = AddonManager["PERM_CAN_" + command.perm.toUpperCase()];
            function ok(addon) !perm || addon.permissions & perm;
            commands.add([command.name],
                command.description,
                function (args) {
                    let name = args[0];
                    if (args.bang)
                        dactyl.assert(!name, "E488: Trailing characters");
                    else
                        dactyl.assert(name, "E471: Argument required");

                    AddonManager.getAddonsByTypes(["extension"], dactyl.wrapCallback(function (list) {
                        if (!args.bang)
                            list = list.filter(function (extension) extension.name == name);
                        if (!args.bang && !list.every(ok))
                            return dactyl.echoerr("Permission denied");
                        if (command.actions)
                            command.actions(list);
                        else
                            list.forEach(command.action);
                    }));
                }, {
                    argCount: "?", // FIXME: should be "1"
                    bang: true,
                    completer: function (context) {
                        completion.extension(context);
                        context.filters.push(function ({ item }) ok(item));
                        if (command.filter)
                            context.filters.push(command.filter);
                    },
                    literal: 0
                });
        });

        commands.add(["exto[ptions]", "extp[references]"],
            "Open an extension's preference dialog",
            function (args) {
                AddonManager.getAddonsByTypes(["extension"], dactyl.wrapCallback(function (list) {
                    list = list.filter(function (extension) extension.name == args[0]);
                    if (!list.length || !list[0].optionsURL)
                        dactyl.echoerr("E474: Invalid argument");
                    else if (args.bang)
                        window.openDialog(list[0].optionsURL, "_blank", "chrome");
                    else
                        dactyl.open(list[0].optionsURL, { from: "extoptions" });
                }));
            }, {
                argCount: "1",
                bang: true,
                completer: function (context) {
                    completion.extension(context);
                    context.filters.push(function ({ item }) item.isActive && item.optionsURL);
                },
                literal: 0
            });

        commands.add(["extens[ions]", "exts"],
            "List available extensions",
            function (args) {
                function addonExtra(e) {
                    let extra;
                    if (e.pendingOperations & AddonManager.PENDING_UNINSTALL)
                        extra = ["Disabled", "uninstalled"];
                    else if (e.pendingOperations & AddonManager.PENDING_DISABLE)
                        extra = ["Disabled", "disabled"];
                    else if (e.pendingOperations & AddonManager.PENDING_INSTALL)
                        extra = ["Enabled", "installed"];
                    else if (e.pendingOperations & AddonManager.PENDING_ENABLE)
                        extra = ["Enabled", "enabled"];
                    else if (e.pendingOperations & AddonManager.PENDING_UPGRADE)
                        extra = ["Enabled", "upgraded"];
                    if (extra)
                        return <>&#xa0;(<span highlight={extra[0]}>{extra[1]}</span>
                                        &#xa0;on restart)</>;
                    return <></>;
                }
                AddonManager.getAddonsByTypes(["extension"], function (extensions) {
                    if (args[0])
                        extensions = extensions.filter(function (extension) extension.name.indexOf(args[0]) >= 0);
                    extensions.sort(function (a, b) String.localeCompare(a.name, b.name));

                    if (extensions.length > 0)
                        commandline.commandOutput(
                            template.tabular(["Name", "Version", "Status", "Description"], [],
                                ([template.icon({ icon: e.iconURL }, e.name),
                                  e.version,
                                  (e.isActive ? <span highlight="Enabled">enabled</span>
                                              : <span highlight="Disabled">disabled</span>) +
                                  addonExtra(e),
                                  e.description]
                                for ([, e] in Iterator(extensions)))));
                    else if (filter)
                        dactyl.echoerr("Exxx: No extension matching " + filter.quote());
                    else
                        dactyl.echoerr("No extensions installed");
                });
            },
            { argCount: "?" });

        commands.add(["exu[sage]"],
            "List all Ex commands with a short description",
            function (args) { Dactyl.showHelpIndex("ex-cmd-index", commands, args.bang); }, {
                argCount: "0",
                bang: true
            });

        [
            {
                name: "h[elp]",
                description: "Open the help page"
            }, {
                name: "helpa[ll]",
                description: "Open the single unchunked help page"
            }
        ].forEach(function (command) {
            let unchunked = command.name == "helpa[ll]";

            commands.add([command.name],
                command.description,
                function (args) {
                    dactyl.assert(!args.bang, "E478: Don't panic!");

                    dactyl.help(args.literalArg, unchunked);
                }, {
                    argCount: "?",
                    bang: true,
                    completer: function (context) completion.help(context, unchunked),
                    literal: 0
                });
        });

        commands.add(["javas[cript]", "js"],
            "Evaluate a JavaScript string",
            function (args) {
                if (args.bang) // open JavaScript console
                    dactyl.open("chrome://global/content/console.xul",
                        { from: "javascript" });
                else
                    dactyl.userEval(args[0]);
            }, {
                bang: true,
                completer: function (context) completion.javascript(context),
                hereDoc: true,
                literal: 0
            });

        commands.add(["loadplugins", "lpl"],
            "Load all plugins immediately",
            function () { dactyl.loadPlugins(); },
            { argCount: "0" });

        commands.add(["norm[al]"],
            "Execute Normal mode commands",
            function (args) { events.feedkeys(args[0] || "", args.bang); },
            {
                argCount: "+",
                bang: true,
                literal: 0
            });

        commands.add(["optionu[sage]"],
            "List all options with a short description",
            function (args) { Dactyl.showHelpIndex("option-index", options, args.bang); },
            {
                argCount: "0",
                bang: true
            });

        commands.add(["q[uit]"],
            dactyl.has("tabs") ? "Quit current tab" : "Quit application",
            function (args) {
                if (dactyl.has("tabs") && tabs.remove(config.browser.mCurrentTab, 1, false))
                    return;
                else if (dactyl.windows.length > 1)
                    window.close();
                else
                    dactyl.quit(false, args.bang);
            }, {
                argCount: "0",
                bang: true
            });

        commands.add(["res[tart]"],
            "Force " + config.appName + " to restart",
            function () { dactyl.restart(); },
            { argCount: "0" });

        var toolbox = document.getElementById("navigator-toolbox");
        if (toolbox) {
            function findToolbar(name) util.evaluateXPath(
                "./*[@toolbarname=" + util.escapeString(name, "'") + "]",
                document, toolbox).snapshotItem(0);

            let toolbarCommand = function (names, desc, action, filter) {
                commands.add(names, desc,
                    function (args) {
                        let toolbar = findToolbar(args[0] || "");
                        dactyl.assert(toolbar, "E474: Invalid argument");
                        action(toolbar);
                        events.checkFocus();
                    }, {
                        argcount: "1",
                        completer: function (context) {
                            completion.toolbar(context);
                            if (filter)
                                context.filters.push(filter);
                        },
                        literal: 0
                    });
            };

            toolbarCommand(["toolbars[how]", "tbs[how]"], "Show the named toolbar",
                function (toolbar) toolbar.collapsed = false,
                function (item) item.item.collapsed);
            toolbarCommand(["toolbarh[ide]", "tbh[ide]"], "Hide the named toolbar",
                function (toolbar) toolbar.collapsed = true,
                function (item) !item.item.collapsed);
            toolbarCommand(["toolbart[oggle]", "tbt[oggle]"], "Toggle the named toolbar",
                function (toolbar) toolbar.collapsed = !toolbar.collapsed);
        }

        commands.add(["time"],
            "Profile a piece of code or run a command multiple times",
            function (args) {
                let count = args.count;
                let special = args.bang;
                args = args[0] || "";

                if (args[0] == ":")
                    var method = function () dactyl.execute(args, null, true);
                else
                    method = dactyl.userFunc(args);

                try {
                    if (count > 1) {
                        let each, eachUnits, totalUnits;
                        let total = 0;

                        for (let i in util.interruptibleRange(0, count, 500)) {
                            let now = Date.now();
                            method();
                            total += Date.now() - now;
                        }

                        if (special)
                            return;

                        if (total / count >= 100) {
                            each = total / 1000.0 / count;
                            eachUnits = "sec";
                        }
                        else {
                            each = total / count;
                            eachUnits = "msec";
                        }

                        if (total >= 100) {
                            total = total / 1000.0;
                            totalUnits = "sec";
                        }
                        else
                            totalUnits = "msec";

                        commandline.commandOutput(
                                <table>
                                    <tr highlight="Title" align="left">
                                        <th colspan="3">Code execution summary</th>
                                    </tr>
                                    <tr><td>&#xa0;&#xa0;Executed:</td><td align="right"><span class="times-executed">{count}</span></td><td>times</td></tr>
                                    <tr><td>&#xa0;&#xa0;Average time:</td><td align="right"><span class="time-average">{each.toFixed(2)}</span></td><td>{eachUnits}</td></tr>
                                    <tr><td>&#xa0;&#xa0;Total time:</td><td align="right"><span class="time-total">{total.toFixed(2)}</span></td><td>{totalUnits}</td></tr>
                                </table>);
                    }
                    else {
                        let beforeTime = Date.now();
                        method();

                        if (special)
                            return;

                        let afterTime = Date.now();

                        if (afterTime - beforeTime >= 100)
                            dactyl.echo("Total time: " + ((afterTime - beforeTime) / 1000.0).toFixed(2) + " sec");
                        else
                            dactyl.echo("Total time: " + (afterTime - beforeTime) + " msec");
                    }
                }
                catch (e) {
                    dactyl.echoerr(e);
                }
            }, {
                argCount: "+",
                bang: true,
                completer: function (context) {
                    if (/^:/.test(context.filter))
                        return completion.ex(context);
                    else
                        return completion.javascript(context);
                },
                count: true,
                literal: 0,
                subCommand: 0
            });

        commands.add(["verb[ose]"],
            "Execute a command with 'verbose' set",
            function (args) {
                let vbs = options.get("verbose");
                let value = vbs.value;
                let setFrom = vbs.setFrom;

                try {
                    vbs.set(args.count || 1);
                    vbs.setFrom = null;
                    dactyl.execute(args[0] || "", null, true);
                }
                finally {
                    vbs.set(value);
                    vbs.setFrom = setFrom;
                }
            }, {
                argCount: "+",
                completer: function (context) completion.ex(context),
                count: true,
                literal: 0,
                subCommand: 0
            });

        commands.add(["ve[rsion]"],
            "Show version information",
            function (args) {
                if (args.bang)
                    dactyl.open("about:");
                else
                    commandline.commandOutput(<>
                        {config.appName} {dactyl.version} running on:<br/>{navigator.userAgent}
                    </>);
            }, {
                argCount: "0",
                bang: true
            });

        commands.add(["viu[sage]"],
            "List all mappings with a short description",
            function (args) { Dactyl.showHelpIndex("normal-index", mappings, args.bang); }, {
                argCount: "0",
                bang: true
            });

    },

    completion: function () {
        completion.dialog = function dialog(context) {
            context.title = ["Dialog"];
            context.filters.push(function ({ item }) !item[2] || item[2]());
            context.completions = [[k, v[0], v[2]] for ([k, v] in Iterator(config.dialogs))];
        };

        completion.extension = function extension(context) {
            context.title = ["Extension"];
            context.anchored = false;
            context.keys = { text: "name", description: "description", icon: "iconURL" },
            context.generate = function () {
                context.incomplete = true;
                AddonManager.getAddonsByTypes(["extension"], function (addons) {
                    context.incomplete = false;
                    context.completions = addons;
                });
            };
        };

        completion.help = function help(context, unchunked) {
            dactyl.initHelp();
            context.title = ["Help"];
            context.anchored = false;
            context.completions = services["dactyl:"].HELP_TAGS;
            if (unchunked)
                context.keys = { text: 0, description: function () "all" };
        };

        completion.menuItem = function menuItem(context) {
            context.title = ["Menu Path", "Label"];
            context.anchored = false;
            context.keys = { text: "fullMenuPath", description: function (item) item.getAttribute("label") };
            context.completions = dactyl.menuItems;
        };

        var toolbox = document.getElementById("navigator-toolbox");
        completion.toolbar = function toolbar(context) {
            context.title = ["Toolbar"];
            context.keys = { text: function (item) item.getAttribute("toolbarname"), description: function () "" };
            context.completions = util.evaluateXPath("./*[@toolbarname]", document, toolbox);
        };

        completion.window = function window(context) {
            context.title = ["Window", "Title"];
            context.keys = { text: function (win) dactyl.windows.indexOf(win) + 1, description: function (win) win.document.title };
            context.completions = dactyl.windows;
        };
    },
    load: function () {
        dactyl.triggerObserver("load");

        dactyl.log("All modules loaded", 3);

        AddonManager.getAddonByID(services["dactyl:"].addonID, function (addon) {
            // @DATE@ token replaced by the Makefile
            // TODO: Find it automatically
            prefs.set("extensions.dactyl.version", addon.version);
            dactyl.version = addon.version + " (created: @DATE@)";
        });

        if (!services.commandLineHandler)
            services.add("commandLineHandler", "@mozilla.org/commandlinehandler/general-startup;1?type=" + config.name);

        let commandline = services.commandLineHandler.optionValue;
        if (commandline) {
            let args = dactyl.parseCommandLine(commandline);
            dactyl.commandLineOptions.rcFile = args["+u"];
            dactyl.commandLineOptions.noPlugins = "++noplugin" in args;
            dactyl.commandLineOptions.postCommands = args["+c"];
            dactyl.commandLineOptions.preCommands = args["++cmd"];
            util.dump("Processing command-line option: " + commandline);
        }

        dactyl.log("Command-line options: " + util.objectToString(dactyl.commandLineOptions), 3);

        // first time intro message
        const firstTime = "extensions." + config.name + ".firsttime";
        if (prefs.get(firstTime, true)) {
            dactyl.timeout(function () {
                this.withSavedValues(["forceNewTab"], function () {
                    this.forceNewTab = true;
                    this.help();
                    prefs.set(firstTime, false);
                });
            }, 1000);
        }

        // TODO: we should have some class where all this guioptions stuff fits well
        // Dactyl.hideGUI();

        if (dactyl.commandLineOptions.preCommands)
            dactyl.commandLineOptions.preCommands.forEach(function (cmd) {
                dactyl.execute(cmd);
            });

        // finally, read the RC file and source plugins
        // make sourcing asynchronous, otherwise commands that open new tabs won't work
        util.timeout(function () {
            let init = services.environment.get(config.idName + "_INIT");
            let rcFile = io.getRCFile("~");

            if (dactyl.userEval('typeof document') === "undefined")
                jsmodules.__proto__ = (window.XPCSafeJSObjectWrapper || XPCNativeWrapper)(window);

            try {
                if (dactyl.commandLineOptions.rcFile) {
                    let filename = dactyl.commandLineOptions.rcFile;
                    if (!/^(NONE|NORC)$/.test(filename))
                        io.source(io.File(filename).path, false); // let io.source handle any read failure like Vim
                }
                else {
                    if (init)
                        dactyl.execute(init);
                    else {
                        if (rcFile) {
                            io.source(rcFile.path, false);
                            services.environment.set("MY_" + config.idName + "RC", rcFile.path);
                        }
                        else
                            dactyl.log("No user RC file found", 3);
                    }

                    if (options["exrc"] && !dactyl.commandLineOptions.rcFile) {
                        let localRCFile = io.getRCFile(io.cwd);
                        if (localRCFile && !localRCFile.equals(rcFile))
                            io.source(localRCFile.path, false);
                    }
                }

                if (dactyl.commandLineOptions.rcFile == "NONE" || dactyl.commandLineOptions.noPlugins)
                    options["loadplugins"] = false;

                if (options["loadplugins"])
                    dactyl.loadPlugins();
            }
            catch (e) {
                dactyl.reportError(e, true);
            }

            // after sourcing the initialization files, this function will set
            // all gui options to their default values, if they have not been
            // set before by any RC file
            for (let option in values(options.needInit))
                option.initValue();

            if (dactyl.commandLineOptions.postCommands)
                dactyl.commandLineOptions.postCommands.forEach(function (cmd) {
                    dactyl.execute(cmd);
                });

            dactyl.fullyInitialized = true;
            dactyl.triggerObserver("enter", null);
            autocommands.trigger("Enter", {});
        }, 0);

        statusline.update();
        dactyl.log(config.appName + " fully initialized", 0);
        dactyl.initialized = true;
    }
});

// vim: set fdm=marker sw=4 ts=4 et:
