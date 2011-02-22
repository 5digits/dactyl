// Copyright (c) 2006-2008 by Martin Stubenschrott <stubenschrott@vimperator.org>
// Copyright (c) 2007-2011 by Doug Kearns <dougkearns@gmail.com>
// Copyright (c) 2008-2011 by Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

/** @scope modules */

default xml namespace = XHTML;
XML.ignoreWhitespace = false;
XML.prettyPrinting = false;

var userContext = { __proto__: modules };
var _userContext = newContext(userContext);

var EVAL_ERROR = "__dactyl_eval_error";
var EVAL_RESULT = "__dactyl_eval_result";
var EVAL_STRING = "__dactyl_eval_string";

var Dactyl = Module("dactyl", XPCOM(Ci.nsISupportsWeakReference, ModuleBase), {
    init: function () {
        window.dactyl = this;
        // cheap attempt at compatibility
        let prop = { get: deprecated("dactyl", function liberator() dactyl) };
        Object.defineProperty(window, "liberator", prop);
        Object.defineProperty(modules, "liberator", prop);
        this.commands = {};
        this.indices = {};
        this.modules = modules;
        this._observers = {};
        util.addObserver(this);

        this.commands["dactyl.help"] = function (event) {
            let elem = event.originalTarget;
            dactyl.help(elem.getAttribute("tag") || elem.textContent);
        };
        this.commands["dactyl.restart"] = function (event) {
            dactyl.restart();
        };

        styles.registerSheet("resource://dactyl-skin/dactyl.css");
    },

    cleanup: function () {
        delete window.dactyl;
        delete window.liberator;

        styles.unregisterSheet("resource://dactyl-skin/dactyl.css");
    },

    destroy: function () {
        autocommands.trigger("LeavePre", {});
        dactyl.triggerObserver("shutdown", null);
        util.dump("All dactyl modules destroyed\n");
        autocommands.trigger("Leave", {});
    },

    observers: {
        "dactyl-cleanup": function dactyl_cleanup() {
            let modules = dactyl.modules;

            let mods = Object.getOwnPropertyNames(modules).reverse()
                             .map(function (name) Object.getOwnPropertyDescriptor(modules, name).value);

            for (let mod in values(mods))
                if (mod instanceof ModuleBase || mod && mod.isLocalModule) {
                    mod.stale = true;
                    if ("cleanup" in mod)
                        this.trapErrors(mod.cleanup, mod);
                    if ("destroy" in mod)
                        this.trapErrors(mod.destroy, mod);
                }

            for (let mod in values(mods))
                if (mod instanceof Class && "INIT" in mod && "cleanup" in mod.INIT)
                    this.trapErrors(mod.cleanup, mod, dactyl, modules, window);

            for (let name in values(Object.getOwnPropertyNames(modules).reverse()))
                try {
                    delete modules[name];
                }
                catch (e) {}
            modules.__proto__ = {};
        }
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

    /**
     * @property {number} The current main mode.
     * @see modes#mainModes
     */
    mode: deprecated("modes.main", {
        get: function mode() modes.main,
        set: function mode(val) modes.main = val
    }),

    get menuItems() Dactyl.getMenuItems(),

    // Global constants
    CURRENT_TAB: "here",
    NEW_TAB: "tab",
    NEW_BACKGROUND_TAB: "background-tab",
    NEW_WINDOW: "window",

    forceNewTab: false,
    forceNewWindow: false,

    version: deprecated("config.version", { get: function version() config.version }),

    /**
     * @property {Object} The map of command-line options. These are
     *     specified in the argument to the host application's -{config.name}
     *     option. E.g. $ firefox -pentadactyl '+u=/tmp/rcfile ++noplugin'
     *     Supported options:
     *         +u RCFILE   Use RCFILE instead of .pentadactylrc.
     *         ++noplugin  Don't load plugins.
     *     These two can be specified multiple times:
     *         ++cmd CMD   Execute an Ex command before initialization.
     *         +c CMD      Execute an Ex command after initialization.
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
        if (!(type in this._observers))
            this._observers[type] = [];
        this._observers[type].push(weak ? Cu.getWeakReference(callback) : { get: function () callback });
    },

    unregisterObserver: function (type, callback) {
        if (type in this._observers)
            this._observers[type] = this._observers[type].filter(function (c) c.get() != callback);
    },

    // TODO: "zoom": if the zoom value of the current buffer changed
    triggerObserver: function (type) {
        let args = Array.slice(arguments, 1);
        if (type in this._observers)
            this._observers[type] = this._observers[type].filter(function (callback) {
                if (callback.get()) {
                    try {
                        try {
                            callback.get().apply(null, args);
                        }
                        catch (e if e.message == "can't wrap XML objects") {
                            // Horrible kludge.
                            callback.get().apply(null, [String(args[0])].concat(args.slice(1)));
                        }
                    }
                    catch (e) {
                        dactyl.reportError(e);
                    }
                    return true;
                }
            });
    },

    addUsageCommand: function (params) {
        let name = commands.add(params.name, params.description,
            function (args) {
                let results = array(params.iterate(args))
                    .sort(function (a, b) String.localeCompare(a.name, b.name));

                let filters = args.map(function (arg) RegExp("\\b" + util.regexp.escape(arg) + "\\b", "i"));
                if (filters.length)
                    results = results.filter(function (item) filters.every(function (re) re.test(item.name + " " + item.description)));

                commandline.commandOutput(
                    template.usage(results, params.format));
            },
            {
                argCount: "*",
                completer: function (context, args) {
                    context.keys.text = util.identity;
                    context.keys.description = function () seen[this.text] + " matching items";
                    let seen = {};
                    context.completions = array(item.description.toLowerCase().split(/[()\s]+/)
                                                for (item in params.iterate(args)))
                        .flatten().filter(function (w) /^\w[\w-_']+$/.test(w))
                        .map(function (k) {
                            seen[k] = (seen[k] || 0) + 1;
                            return k;
                        }).uniq();
                },
                options: params.options || []
            });

        if (params.index)
            this.indices[params.index] = function () {
                let results = array((params.iterateIndex || params.iterate).call(params, commands.get(name).newArgs()))
                        .array.sort(function (a, b) String.localeCompare(a.name, b.name));

                let tags = services["dactyl:"].HELP_TAGS;
                for (let obj in values(results)) {
                    let res = dactyl.generateHelp(obj, null, null, true);
                    if (!set.has(tags, obj.helpTag))
                        res[1].@tag = obj.helpTag;

                    yield res;
                }
            };
    },

    /**
     * Triggers the application bell to notify the user of an error. The
     * bell may be either audible or visual depending on the value of the
     * 'visualbell' option.
     */
    beep: function () {
        this.triggerObserver("beep");
        if (options["visualbell"]) {
            let elems = {
                bell: document.getElementById("dactyl-bell"),
                strut: document.getElementById("dactyl-bell-strut")
            };
            XML.ignoreWhitespace = true;
            if (!elems.bell)
                util.overlayWindow(window, {
                    objects: elems,
                    prepend: <>
                        <window id={document.documentElement.id} xmlns={XUL}>
                            <hbox style="display: none" highlight="Bell" id="dactyl-bell" key="bell"/>
                        </window>
                    </>,
                    append: <>
                        <window id={document.documentElement.id} xmlns={XUL}>
                            <hbox style="display: none" highlight="Bell" id="dactyl-bell-strut" key="strut"/>
                        </window>
                    </>
                }, elems);

            elems.bell.style.height = window.innerHeight + "px";
            elems.strut.style.marginBottom = -window.innerHeight + "px";
            elems.strut.style.display = elems.bell.style.display = "";

            util.timeout(function () { elems.strut.style.display = elems.bell.style.display = "none"; }, 20);
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
        try {
            const clipboard = Cc["@mozilla.org/widget/clipboard;1"].getService(Ci.nsIClipboard);
            const transferable = Cc["@mozilla.org/widget/transferable;1"].createInstance(Ci.nsITransferable);

            transferable.addDataFlavor("text/unicode");

            let source = clipboard[getClipboard || !clipboard.supportsSelectionClipboard() ?
                                   "kGlobalClipboard" : "kSelectionClipboard"];
            clipboard.getData(transferable, source);

            let str = {}, len = {};
            transferable.getTransferData("text/unicode", str, len);

            if (str)
                return str.value.QueryInterface(Ci.nsISupportsString)
                          .data.substr(0, len.value / 2);
        }
        catch (e) {}
        return null;
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

    dump: deprecated("util.dump",
                     { get: function dump() util.closure.dump }),
    dumpStack: deprecated("util.dumpStack",
                          { get: function dumpStack() util.closure.dumpStack }),

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
        else if (isinstance(str, ["Error"]) && str.fileName)
            str = <>{str.fileName.replace(/^.* -> /, "")}: {str.lineNumber}: {str}</>;

        if (options["errorbells"])
            dactyl.beep();

        commandline.echo(str, commandline.HL_ERRORMSG, flags);
    },

    /**
     * Outputs a warning message to the command line.
     *
     * @param {string} str The message to output.
     * @param {number} flags These control the multi-line message behavior.
     *     See {@link CommandLine#echo}.
     */
    warn: function warn(str, flags) {
        commandline.echo(str, "WarningMsg", flags | commandline.APPEND_TO_MESSAGES);
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
        if (verbosity == null)
            verbosity = 0; // verbosity level is exclusionary

        if (options["verbose"] >= verbosity)
            commandline.echo(str, commandline.HL_INFOMSG,
                             flags | commandline.APPEND_TO_MESSAGES);
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
        JSMLoader.loadSubScript(uri, context, File.defaultEncoding);
    },

    userEval: function (str, context, fileName, lineNumber) {
        let ctxt;
        if (jsmodules.__proto__ != window)
            str = "with (window) { with (modules) { (this.eval || eval)(" + str.quote() + ") } }";

        let info = contexts.context;
        if (fileName == null)
            if (info && info.file[0] !== "[")
                ({ file: fileName, line: lineNumber, context: ctxt }) = info;

        if (!context && fileName && fileName[0] !== "[")
            context = _userContext || ctxt;

        if (isinstance(context, ["Sandbox"]))
            return Cu.evalInSandbox(str, context, "1.8", fileName, lineNumber);
        else
            try {
                if (!context)
                    context = userContext || ctxt;

                context[EVAL_ERROR] = null;
                context[EVAL_STRING] = str;
                context[EVAL_RESULT] = null;
                this.loadScript("resource://dactyl-content/eval.js", context);
                if (context[EVAL_ERROR]) {
                    try {
                        context[EVAL_ERROR].fileName = info.file;
                        context[EVAL_ERROR].lineNumber += info.line;
                    }
                    catch (e) {}
                    throw context[EVAL_ERROR];
                }
                return context[EVAL_RESULT];
            }
            finally {
                delete context[EVAL_ERROR];
                delete context[EVAL_RESULT];
                delete context[EVAL_STRING];
            }
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
            commands.lastCommand = str.replace(/^\s*:\s*/, "");
        let res = true;
        for (let [command, args] in commands.parseCommands(str.replace(/^'(.*)'$/, "$1"))) {
            if (command === null)
                throw FailedAssertion("E492: Not a " + config.appName + " command: " + args.commandString);

            res = res && command.execute(args, modifiers);
        }
        return res;
    },

    focus: function focus(elem, flags) {
        flags = flags || services.focus.FLAG_BYMOUSE;
        try {
            if (elem instanceof Document)
                elem = elem.defaultView;
            if (elem instanceof Window)
                services.focus.focusedWindow = elem;
            else
                services.focus.setFocus(elem, flags);
        }
        catch (e) {
            util.dump(elem);
            util.reportError(e);
        }
    },

    /**
     * Focuses the content window.
     *
     * @param {boolean} clearFocusedElement Remove focus from any focused
     *     element.
     */
    focusContent: function focusContent(clearFocusedElement) {
        if (window != services.focus.activeWindow)
            return;

        let win = document.commandDispatcher.focusedWindow;
        let elem = config.mainWidget || content;

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
                if (frame && frame.top == content && !Editor.getEditor(frame))
                    elem = frame;
            }
        }
        catch (e) {}

        if (clearFocusedElement) {
            if (dactyl.focusedElement)
                dactyl.focusedElement.blur();
            if (win && Editor.getEditor(win)) {
                win.blur();
                if (win.frameElement)
                    win.frameElement.blur();
            }
        }

        if (elem instanceof Window && Editor.getEditor(elem))
            elem = window;

        if (elem && elem != dactyl.focusedElement)
            dactyl.focus(elem);
     },

    /** @property {Element} The currently focused element. */
    get focusedElement() services.focus.getFocusedElementForWindow(window, true, {}),
    set focusedElement(elem) dactyl.focus(elem),

    /**
     * Returns whether this Dactyl extension supports *feature*.
     *
     * @param {string} feature The feature name.
     * @returns {boolean}
     */
    has: function (feature) set.has(config.features, feature),

    /**
     * Returns the URL of the specified help *topic* if it exists.
     *
     * @param {string} topic The help topic to look up.
     * @param {boolean} consolidated Whether to search the consolidated help page.
     * @returns {string}
     */
    findHelp: function (topic, consolidated) {
        if (!consolidated && topic in services["dactyl:"].FILE_MAP)
            return topic;
        let items = completion._runCompleter("help", topic, null, !!consolidated).items;
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
     */
    initDocument: function initDocument(doc) {
        try {
            if (doc.location.protocol === "dactyl:") {
                dactyl.initHelp();
                config.styleHelp();
            }
        }
        catch (e) {
            util.reportError(e);
        }
    },

    /**
     * @private
     * Initialize the help system.
     */
    initHelp: function (force) {
        if (force || !this.helpInitialized) {
            if ("noscriptOverlay" in window) {
                noscriptOverlay.safeAllow("chrome-data:", true, false);
                noscriptOverlay.safeAllow("dactyl:", true, false);
            }

            // Find help and overlay files with the given name.
            let findHelpFile = function findHelpFile(file) {
                let result = [];
                for (let [, namespace] in Iterator(namespaces)) {
                    let url = ["dactyl://", namespace, "/", file, ".xml"].join("");
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
            };
            // Find the tags in the document.
            let addTags = function addTags(file, doc) {
                for (let elem in util.evaluateXPath("//@tag|//dactyl:tags/text()|//dactyl:tag/text()", doc))
                    for (let tag in values((elem.value || elem.textContent).split(/\s+/)))
                        tagMap[tag] = file;
            };

            let namespaces = ["locale-local", "locale"];
            services["dactyl:"].init({});

            let tagMap = services["dactyl:"].HELP_TAGS;
            let fileMap = services["dactyl:"].FILE_MAP;
            let overlayMap = services["dactyl:"].OVERLAY_MAP;

            // Scrape the list of help files from all.xml
            // Manually process main and overlay files, since XSLTProcessor and
            // XMLHttpRequest don't allow access to chrome documents.
            tagMap["all"] = tagMap["all.xml"] = "all";
            tagMap["versions"] = tagMap["versions.xml"] = "versions";
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
            XML.ignoreWhiteSpace = XML.prettyPrinting = false;

            let body = XML();
            for (let [, context] in Iterator(plugins.contexts))
                if (context && context.INFO instanceof XML) {
                    let info = context.INFO;
                    if (info.*.@lang.length()) {
                        let lang = config.bestLocale(String(a) for each (a in info.*.@lang));

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
                '<?xml-stylesheet type="text/xsl" href="dactyl://content/help.xsl"?>\n' +
                '<!DOCTYPE document SYSTEM "resource://dactyl-content/dactyl.dtd">\n' +
                unescape(encodeURI( // UTF-8 handling hack.
                <document xmlns={NS}
                    name="plugins" title={config.appName + " Plugins"}>
                    <h1 tag="using-plugins">Using Plugins</h1>
                    <toc start="2"/>

                    {body}
                </document>.toXMLString()));
            fileMap["plugins"] = function () ['text/xml;charset=UTF-8', help];

            fileMap["versions"] = function () {
                let NEWS = util.httpGet(config.addon.getResourceURI("NEWS").spec,
                                        { mimeType: "text/plain;charset=UTF-8" })
                               .responseText;

                let re = util.regexp(<![CDATA[
                      ^ (?P<comment> \s* # .*\n)

                    | ^ (?P<space> \s*)
                        (?P<char>  [-•*+]) \ //
                      (?P<content> .*\n
                         (?: \2\ \ .*\n | \s*\n)* )

                    | (?P<par>
                          (?: ^ [^\S\n]*
                              (?:[^-•*+\s] | [-•*+]\S)
                              .*\n
                          )+
                      )

                    | (?: ^ [^\S\n]* \n) +
                ]]>, "gmxy");

                let betas = util.regexp(/\[(b\d)\]/, "gx");

                let beta = array(betas.iterate(NEWS))
                            .map(function (m) m[1]).uniq().slice(-1)[0];

                default xml namespace = NS;
                function rec(text, level, li) {
                    let res = <></>;
                    let list, space, i = 0;

                    for (let match in re.iterate(text)) {
                        if (match.comment)
                            continue;
                        else if (match.char) {
                            if (!list)
                                res += list = <ul/>;
                            let li = <li/>;
                            li.* += rec(match.content.replace(RegExp("^" + match.space, "gm"), ""), level + 1, li)
                            list.* += li;
                        }
                        else if (match.par) {
                            let [, par, tags] = /([^]*?)\s*((?:\[[^\]]+\])*)\n*$/.exec(match.par);
                            let t = tags;
                            tags = array(betas.iterate(tags)).map(function (m) m[1]);

                            let group = !tags.length                       ? "" :
                                        !tags.some(function (t) t == beta) ? "HelpNewsOld" : "HelpNewsNew";
                            if (i === 0 && li) {
                                li.@highlight = group;
                                group = "";
                            }

                            list = null;
                            if (level == 0 && /^.*:\n$/.test(match.par))
                                res += <h2>{template.linkifyHelp(par.slice(0, -1), true)}</h2>;
                            else {
                                let [, a, b] = /^(IMPORTANT:?)?([^]*)/.exec(par);
                                res += <p highlight={group + " HelpNews"}>{
                                    !tags.length ? "" :
                                    <hl key="HelpNewsTag">{tags.join(" ")}</hl>
                                }{
                                    a ? <hl key="HelpWarning">{a}</hl> : ""
                                }{
                                    template.linkifyHelp(b, true)
                                }</p>;
                            }
                        }
                        i++;
                    }
                    for each (let attr in res..@highlight) {
                        attr.parent().@NS::highlight = attr;
                        delete attr.parent().@highlight;
                    }
                    return res;
                }

                let body = rec(NEWS, 0);
                for each (let li in body..li) {
                    let list = li..li.(@NS::highlight == "HelpNewsOld");
                    if (list.length() && list.length() == li..li.(@NS::highlight != "").length()) {
                        for each (let li in list)
                            li.@NS::highlight = "";
                        li.@NS::highlight = "HelpNewsOld";
                    }
                }

                XML.prettyPrinting = XML.ignoreWhitespace = false;
                return ["application/xml",
                    '<?xml version="1.0"?>\n' +
                    '<?xml-stylesheet type="text/xsl" href="dactyl://content/help.xsl"?>\n' +
                    '<!DOCTYPE document SYSTEM "resource://dactyl-content/dactyl.dtd">\n' +
                    unescape(encodeURI( // UTF-8 handling hack.
                    <document xmlns={NS} xmlns:dactyl={NS}
                        name="versions" title={config.appName + " Versions"}>
                        <h1 tag="versions news NEWS">{config.appName} Versions</h1>
                        <toc start="2"/>

                        {body}
                    </document>.toXMLString()))
                ];
            }
            addTags("versions", util.httpGet("dactyl://help/versions").responseXML);
            addTags("plugins", util.httpGet("dactyl://help/plugins").responseXML);

            default xml namespace = NS;

            overlayMap["index"] = ['text/xml;charset=UTF-8',
                '<?xml version="1.0"?>\n' +
                '<overlay xmlns="' + NS + '">\n' +
                unescape(encodeURI( // UTF-8 handling hack.
                template.map(dactyl.indices, function ([name, iter])
                    <dl insertafter={name + "-index"}>{
                        template.map(iter(), util.identity)
                    }</dl>, <>{"\n\n"}</>))) +
                '\n</overlay>'];

            addTags("index", util.httpGet("dactyl://help-overlay/index").responseXML);

            this.helpInitialized = true;
        }
    },

    stringifyXML: function (xml) {
        XML.prettyPrinting = false;
        XML.ignoreWhitespace = false;
        return UTF8(xml.toXMLString());
    },

    exportHelp: JavaScript.setCompleter(function (path) {
        const FILE = io.File(path);
        const PATH = FILE.leafName.replace(/\..*/, "") + "/";
        const TIME = Date.now();

        if (!FILE.exists() && (/\/$/.test(path) && !/\./.test(FILE.leafName)))
            FILE.create(FILE.DIRECTORY_TYPE, octal(755));

        dactyl.initHelp();
        if (FILE.isDirectory()) {
            var addDataEntry = function addDataEntry(file, data) FILE.child(file).write(data);
            var addURIEntry  = function addURIEntry(file, uri) addDataEntry(file, util.httpGet(uri).responseText);
        }
        else {
            var zip = services.ZipWriter();
            zip.open(FILE, File.MODE_CREATE | File.MODE_WRONLY | File.MODE_TRUNCATE);

            addURIEntry = function addURIEntry(file, uri)
                zip.addEntryChannel(PATH + file, TIME, 9,
                    services.io.newChannel(uri, null, null), false);
            addDataEntry = function addDataEntry(file, data) // Unideal to an extreme.
                addURIEntry(file, "data:text/plain;charset=UTF-8," + encodeURI(data));
        }

        let empty = set("area base basefont br col frame hr img input isindex link meta param"
                            .split(" "));
        function fix(node) {
            switch(node.nodeType) {
                case Node.ELEMENT_NODE:
                    if (isinstance(node, [HTMLBaseElement]))
                        return;

                    data.push("<"); data.push(node.localName);
                    if (node instanceof HTMLHtmlElement)
                        data.push(" xmlns=" + XHTML.uri.quote());

                    for (let { name, value } in array.iterValues(node.attributes)) {
                        if (name == "dactyl:highlight") {
                            set.add(styles, value);
                            name = "class";
                            value = "hl-" + value;
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
                            chromeFiles[value] = value.replace(/.*\//, "");
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

        let chromeFiles = {};
        let styles = {};
        for (let [file, ] in Iterator(services["dactyl:"].FILE_MAP)) {
            dactyl.open("dactyl://help/" + file);
            dactyl.modules.events.waitForPageLoad();
            let data = [
                '<?xml version="1.0" encoding="UTF-8"?>\n',
                '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN"\n',
                '          "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">\n'
            ];
            fix(content.document.documentElement);
            addDataEntry(file + ".xhtml", data.join(""));
        }

        let data = [h for (h in highlight) if (set.has(styles, h.class) || /^Help/.test(h.class))]
            .map(function (h) h.selector
                               .replace(/^\[.*?=(.*?)\]/, ".hl-$1")
                               .replace(/html\|/g, "") + "\t" + "{" + h.cssText + "}")
            .join("\n");
        addDataEntry("help.css", data.replace(/chrome:[^ ")]+\//g, ""));

        addDataEntry("tag-map.json", JSON.stringify(services["dactyl:"].HELP_TAGS));

        let m, re = /(chrome:[^ ");]+\/)([^ ");]+)/g;
        while ((m = re.exec(data)))
            chromeFiles[m[0]] = m[2];

        for (let [uri, leaf] in Iterator(chromeFiles))
            addURIEntry(leaf, uri);

        if (zip)
            zip.close();
    }, [function (context, args) completion.file(context)]),

    /**
     * Generates a help entry and returns it as a string.
     *
     * @param {Command|Map|Option} obj A dactyl *Command*, *Map* or *Option*
     *     object
     * @param {XMLList} extraHelp Extra help text beyond the description.
     * @returns {string}
     */
    generateHelp: function generateHelp(obj, extraHelp, str, specOnly) {
        default xml namespace = "";

        let link, tag, spec;
        link = tag = spec = util.identity;
        let args = null;

        if (obj instanceof Command) {
            link = function (cmd) <ex>{cmd}</ex>;
            args = obj.parseArgs("", CompletionContext(str || ""));
            spec = function (cmd) cmd + (obj.bang ? <oa>!</oa> : <></>);
        }
        else if (obj instanceof Map) {
            spec = function (map) obj.count ? <><oa>count</oa>{map}</> : <>{map}</>;
            link = function (map) {
                let [, mode, name, extra] = /^(?:(.)_)?(?:<([^>]+)>)?(.*)$/.exec(map);
                let k = <k>{extra}</k>;
                if (name)
                    k.@name = name;
                if (mode)
                    k.@mode = mode;
                return k;
            };
        }
        else if (obj instanceof Option) {
            link = function (opt, name) <o>{name}</o>;
        }

        XML.prettyPrinting = false;
        XML.ignoreWhitespace = false;
        default xml namespace = NS;

        // E4X has its warts.
        let br = <>
                    </>;

        let res = <res>
                <dt>{link(obj.helpTag || obj.name, obj.name)}</dt> <dd>{
                    template.linkifyHelp(obj.description ? obj.description.replace(/\.$/, "") : "", true)
                }</dd></res>;
        if (specOnly)
            return res.elements();

        res.* += <>
            <item>
                <tags>{template.map(obj.names.slice().reverse(), tag, " ")}</tags>
                <spec>{
                    spec(template.highlightRegexp((obj.specs || obj.names)[0],
                                                  /\[(.*?)\]/g,
                                                  function (m, n0) <oa>{n0}</oa>))
                }</spec>{
                !obj.type ? "" : <>
                <type>{obj.type}</type>
                <default>{obj.stringDefaultValue}</default></>}
                <description>{
                    obj.description ? br + <p>{template.linkifyHelp(obj.description.replace(/\.?$/, "."), true)}</p> : "" }{
                        extraHelp ? br + extraHelp : "" }{
                        !(extraHelp || obj.description) ? br + <p>Sorry, no help available.</p> : "" }
                </description>
            </item></>;

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
        return res.*.toXMLString()
                  .replace(' xmlns="' + NS + '"', "", "g")
                  .replace(/^ {12}|[ \t]+$/gm, "")
                  .replace(/^\s*\n|\n\s*$/g, "") + "\n";
    },

    /**
     * Opens the help page containing the specified *topic* if it exists.
     *
     * @param {string} topic The help topic to open.
     * @param {boolean} consolidated Whether to use the consolidated help page.
     */
    help: function (topic, consolidated) {
        dactyl.initHelp();
        if (!topic) {
            let helpFile = consolidated ? "all" : options["helpfile"];

            if (helpFile in services["dactyl:"].FILE_MAP)
                dactyl.open("dactyl://help/" + helpFile, { from: "help" });
            else
                dactyl.echomsg("Sorry, help file " + helpFile.quote() + " not found");
            return;
        }

        let page = this.findHelp(topic, consolidated);
        dactyl.assert(page != null, "E149: Sorry, no help for " + topic);

        dactyl.open("dactyl://help/" + page, { from: "help" });
    },

    /**
     * The map of global variables.
     *
     * These are set and accessed with the "g:" prefix.
     */
    _globalVariables: {},
    globalVariables: deprecated("the options system", {
        get: function globalVariables() this._globalVariables
    }),

    loadPlugins: function (args, force) {
        function sourceDirectory(dir) {
            dactyl.assert(dir.isReadable(), "E484: Can't open file " + dir.path);

            dactyl.log("Sourcing plugin directory: " + dir.path + "...", 3);

            let loadplugins = options.get("loadplugins");
            if (args)
                loadplugins = { __proto__: loadplugins, value: args.map(Option.parseRegexp) }

            dir.readDirectory(true).forEach(function (file) {
                if (file.isFile() && loadplugins.getKey(file.path) && !(!force && file.path in dactyl.pluginFiles)) {
                    try {
                        io.source(file.path);
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
        let verbose = localPrefs.get("loglevel", 0);

        if (!level || level <= verbose) {
            if (isObject(msg))
                msg = util.objectToString(msg, false);

            services.console.logStringMessage(config.name + ": " + msg);
        }
    },

    onClick: function onClick(event) {
        let command = event.originalTarget.getAttributeNS(NS, "command");
        if (command && event.button == 0) {
            event.preventDefault();

            if (dactyl.commands[command])
                dactyl.withSavedValues(["forceNewTab"], function () {
                    dactyl.forceNewTab = event.ctrlKey || event.shiftKey || event.button == 1;
                    dactyl.commands[command](event);
                });
        }
    },

    onExecute: function onExecute(event) {
        let cmd = event.originalTarget.getAttribute("dactyl-execute");
        commands.execute(cmd, null, false, null,
                         { file: "[Command Line]", line: 1 });
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

        if (urls.length > prefs.get("browser.tabs.maxOpenBeforeWarn", 20) && !force)
            return commandline.input("This will open " + urls.length + " new tabs. Would you like to continue? (yes/[no]) ",
                function (resp) {
                    if (resp && resp.match(/^y(es)?$/i))
                        dactyl.open(urls, params, true);
                });

        params = params || {};
        if (isString(params))
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

        let browser = config.tabbrowser;
        function open(urls, where) {
            try {
                let url = Array.concat(urls)[0];
                let postdata = Array.concat(urls)[1];

                // decide where to load the first url
                switch (where) {

                case dactyl.NEW_TAB:
                    if (!dactyl.has("tabs"))
                        return open(urls, dactyl.NEW_WINDOW);

                    return prefs.withContext(function () {
                        prefs.set("browser.tabs.loadInBackground", true);
                        return browser.loadOneTab(url, null, null, postdata, background).linkedBrowser.contentDocument;
                    });

                case dactyl.NEW_WINDOW:
                    let win = window.openDialog(document.documentURI, "_blank", "chrome,all,dialog=no");
                    util.waitFor(function () win.document.readyState === "complete");
                    browser = win.dactyl && win.dactyl.modules.config.tabbrowser || win.getBrowser();
                    // FALLTHROUGH
                case dactyl.CURRENT_TAB:
                    browser.loadURIWithFlags(url, flags, null, null, postdata);
                    return browser.contentWindow;
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

        return urls.map(function (url) {
            let res = open(url, where);
            where = dactyl.NEW_TAB;
            background = true;
            return res;
        });
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
    parseURLs: function parseURLs(str) {
        let urls;

        if (options["urlseparator"])
            urls = util.splitLiteral(str, RegExp("\\s*" + options["urlseparator"] + "\\s*"));
        else
            urls = [str];

        return urls.map(function (url) {
            url = url.trim();

            if (/^(\.{0,2}|~)(\/|$)/.test(url)) {
                try {
                    // Try to find a matching file.
                    let file = io.File(url);
                    if (file.exists() && file.isReadable())
                        return services.io.newFileURI(file).spec;
                }
                catch (e) {}
            }

            // If it starts with a valid protocol, pass it through.
            let proto = /^([-\w]+):/.exec(url);
            if (proto && "@mozilla.org/network/protocol;1?name=" + proto[1] in Cc)
                return url.replace(/\s+/g, "");

            // Check for a matching search keyword.
            let searchURL = loaded.bookmarks && bookmarks.getSearchURL(url, false);
            if (searchURL)
                return searchURL;

            // If it looks like URL-ish (foo.com/bar), let Gecko figure it out.
            if (this.urlish.test(url) || !loaded.bookmarks)
                return util.createURI(url).spec;

            // Pass it off to the default search engine or, failing
            // that, let Gecko deal with it as is.
            return bookmarks.getSearchURL(url, true) || util.createURI(url).spec;
        }, this);
    },
    stringToURLArray: deprecated("dactyl.parseURLs", "parseURLs"),
    urlish: Class.memoize(function () util.regexp(<![CDATA[
            ^ (
                <domain>+ (:\d+)? (/ .*) |
                <domain>+ (:\d+) |
                <domain>+ \. [a-z0-9]+ |
                localhost
            ) $
        ]]>, "ix", {
        domain: util.regexp(String.replace(<![CDATA[
            [^
                U0000-U002c // U002d-U002e --.
                U002f       // /
                            // U0030-U0039 0-9
                U003a-U0040 // U0041-U005a a-z
                U005b-U0060 // U0061-U007a A-Z
                U007b-U007f
            ]
        ]]>, /U/g, "\\u"), "x")
    })),

    pluginFiles: {},

    get plugins() plugins,

    setNodeVisible: function setNodeVisible(node, visible) {
        if (window.setToolbarVisibility && node.localName == "toolbar")
            window.setToolbarVisibility(node, visible);
        else
            node.collapsed = !visible;
    },

    confirmQuit: function confirmQuit()
        prefs.withContext(function () {
            prefs.set("browser.warnOnQuit", false);
            return window.canQuitApplication();
        }),

    /**
     * Quit the host application, no matter how many tabs/windows are open.
     *
     * @param {boolean} saveSession If true the current session will be
     *     saved and restored when the host application is restarted.
     * @param {boolean} force Forcibly quit irrespective of whether all
     *    windows could be closed individually.
     */
    quit: function (saveSession, force) {
        if (!force && !this.confirmQuit())
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
     * Restart the host application.
     */
    restart: function () {
        if (!this.confirmQuit())
            return;

        services.appStartup.quit(Ci.nsIAppStartup.eAttemptQuit | Ci.nsIAppStartup.eRestart);
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
            if (isString(func))
                func = self[func];
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
            let context = contexts.context;
            let prefix = context ? context.file + ":" + context.line + ": " : "";
            if (error.message && error.message.indexOf(prefix) !== 0)
                error.message = prefix + error.message;

            if (error.message)
                dactyl.echoerr(template.linkifyHelp(error.message));
            else
                dactyl.beep();

            if (!error.noTrace)
                util.reportError(error);
            return;
        }
        if (error.result == Cr.NS_BINDING_ABORTED)
            return;
        if (echo)
            dactyl.echoerr(error, commandline.FORCE_SINGLELINE);
        util.reportError(error);
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
        try {
            return commands.get("rehash").parseArgs(cmdline);
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
            let args = arguments;
            return dactyl.withSavedValues(save, function () {
                saved.forEach(function (p, i) dactyl[save[i]] = p);
                try {
                    return callback.apply(self, args);
                }
                catch (e) {
                    dactyl.reportError(e, true);
                }
            });
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
    }
}, {
    events: function () {
        events.listen(window, "click", dactyl.closure.onClick, true);
        events.listen(window, "dactyl.execute", dactyl.closure.onExecute, true);
    },
    // Only general options are added here, which are valid for all Dactyl extensions
    options: function () {
        options.add(["errorbells", "eb"],
            "Ring the bell when an error message is displayed",
            "boolean", false);

        options.add(["exrc", "ex"],
            "Enable automatic sourcing of an RC file in the current directory at startup",
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
                    if (loaded.commandline)
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
                                dactyl.setNodeVisible(elem, opts.indexOf(opt) >= 0);
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

                    styles.system.add("scrollbar", "*",
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

                    styles.system.add("taboptions", "chrome://*",
                                      classes.length ? classes.join(",") + "{ display: none; }" : "");

                    if (!dactyl.has("Gecko2")) {
                        tabs.tabBinding.enabled = Array.some(opts, function (k) k in this.opts, this);
                        tabs.updateTabCount();
                    }
                    if (config.tabbrowser.tabContainer._positionPinnedTabs)
                        config.tabbrowser.tabContainer._positionPinnedTabs();
                },
                /*
                validator: function (opts) dactyl.has("Gecko2") ||
                    Option.validIf(!/[nN]/.test(opts), "Tab numbering not available in this " + config.host + " version")
                 */
            }
        ].filter(function (group) !group.feature || dactyl.has(group.feature));

        options.add(["guioptions", "go"],
            "Show or hide certain GUI elements like the menu or toolbar",
            "charlist", config.defaults.guioptions || "", {

                // FIXME: cleanup
                cleanupValue: config.cleanups.guioptions ||
                    "r" + [k for ([k, v] in iter(groups[1].opts))
                           if (!document.getElementById(v[1][0]).collapsed)].join(""),

                values: array(groups).map(function (g) [[k, v[0]] for ([k, v] in Iterator(g.opts))]).flatten(),

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
            "The string shown at the end of the window title",
            "string", config.defaults.titlestring || config.host,
            {
                setter: function (value) {
                    let win = document.documentElement;
                    function updateTitle(old, current) {
                        document.title = document.title.replace(RegExp("(.*)" + util.regexp.escape(old)), "$1" + current);
                    }

                    if (services.has("privateBrowsing")) {
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
            "The regular expression used to separate multiple URLs in :open and friends",
            "string", "\\|",
            { validator: function (value) RegExp(value) });

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
        mappings.add([modes.MAIN], ["<F1>"],
            "Open the introductory help page",
            function () { dactyl.help(); });

        mappings.add([modes.MAIN], ["<A-F1>"],
            "Open the single, consolidated help page",
            function () { ex.helpall(); });

        if (dactyl.has("session"))
            mappings.add([modes.NORMAL], ["ZQ"],
                "Quit and don't save the session",
                function () { dactyl.quit(false); });

        mappings.add([modes.NORMAL], ["ZZ"],
            "Quit and save the session",
            function () { dactyl.quit(true); });
    },

    commands: function () {
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
                    completion.dialog(context);
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
                    dactyl.execute(cmd || "", null, true);
                }
                catch (e) {
                    dactyl.echoerr(e);
                }
            }, {
                completer: function (context) completion.javascript(context),
                literal: 0
            });

        [
            {
                name: "h[elp]",
                description: "Open the introductory help page"
            }, {
                name: "helpa[ll]",
                description: "Open the single consolidated help page"
            }
        ].forEach(function (command) {
            let consolidated = command.name == "helpa[ll]";

            commands.add([command.name],
                command.description,
                function (args) {
                    dactyl.assert(!args.bang, "E478: Don't panic!");
                    dactyl.help(args.literalArg, consolidated);
                }, {
                    argCount: "?",
                    bang: true,
                    completer: function (context) completion.help(context, consolidated),
                    literal: 0
                });
        });

        commands.add(["loadplugins", "lpl"],
            "Load all plugins immediately",
            function (args) {
                dactyl.loadPlugins(args.length ? args : null, args.bang);
            },
            {
                argCount: "*",
                bang: true,
                keepQuotes: true,
                serialGroup: 10,
                serialize: function ()  [
                    {
                        command: this.name,
                        literalArg: options["loadplugins"].join(" ")
                    }
                ]
            });

        commands.add(["norm[al]"],
            "Execute Normal mode commands",
            function (args) { events.feedkeys(args[0], args.bang, false, modes.NORMAL); },
            {
                argCount: "1",
                bang: true,
                literal: 0
            });

        commands.add(["q[uit]"],
            dactyl.has("tabs") ? "Quit current tab" : "Quit application",
            function (args) {
                if (dactyl.has("tabs") && tabs.remove(tabs.getTab(), 1, false))
                    return;
                else if (dactyl.windows.length > 1)
                    window.close();
                else
                    dactyl.quit(false, args.bang);
            }, {
                argCount: "0",
                bang: true
            });

        commands.add(["reh[ash]"],
            "Reload the " + config.appName + " add-on",
            function (args) {
                if (args.trailing)
                    JSMLoader.rehashCmd = args.trailing; // Hack.
                args.break = true;
                util.rehash(args);
            },
            {
                argCount: "0",
                options: [
                    {
                        names: ["+u"],
                        description: "The initialization file to execute at startup",
                        type: CommandOption.STRING
                    },
                    {
                        names: ["++noplugin"],
                        description: "Do not automatically load plugins"
                    },
                    {
                        names: ["++cmd"],
                        description: "Ex commands to execute prior to initialization",
                        type: CommandOption.STRING,
                        multiple: true
                    },
                    {
                        names: ["+c"],
                        description: "Ex commands to execute after initialization",
                        type: CommandOption.STRING,
                        multiple: true
                    }
                ]
            });

        commands.add(["res[tart]"],
            "Force " + config.appName + " to restart",
            function () { dactyl.restart(); });

        function findToolbar(name) util.evaluateXPath(
            "//*[@toolbarname=" + util.escapeString(name, "'") + "]",
            document).snapshotItem(0);

        var toolbox = document.getElementById("navigator-toolbox");
        if (toolbox) {
            let hidden = function hidden(elem) (elem.getAttribute("autohide") || elem.getAttribute("collapsed")) == "true";

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
                function (toolbar) dactyl.setNodeVisible(toolbar, true),
                function ({ item }) hidden(item));
            toolbarCommand(["toolbarh[ide]", "tbh[ide]"], "Hide the named toolbar",
                function (toolbar) dactyl.setNodeVisible(toolbar, false),
                function ({ item }) !hidden(item));
            toolbarCommand(["toolbart[oggle]", "tbt[oggle]"], "Toggle the named toolbar",
                function (toolbar) dactyl.setNodeVisible(toolbar, hidden(toolbar)));
        }

        commands.add(["time"],
            "Profile a piece of code or run a command multiple times",
            function (args) {
                let count = args.count;
                let special = args.bang;
                args = args[0] || "";

                if (args[0] == ":")
                    var method = function () commands.execute(args, null, true);
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
                hereDoc: true,
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
                        {config.appName} {config.version} running on:<br/>{navigator.userAgent}
                    </>);
            }, {
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

        completion.help = function help(context, consolidated) {
            dactyl.initHelp();
            context.title = ["Help"];
            context.anchored = false;
            context.completions = services["dactyl:"].HELP_TAGS;
            if (consolidated)
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
            context.completions = util.evaluateXPath("//*[@toolbarname]", document);
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

        dactyl.timeout(function () {
            try {
                var args = JSMLoader.commandlineArgs || services.commandLineHandler.optionValue;
                if (isString(args))
                    args = dactyl.parseCommandLine(args);

                if (args) {
                    dactyl.commandLineOptions.rcFile = args["+u"];
                    dactyl.commandLineOptions.noPlugins = "++noplugin" in args;
                    dactyl.commandLineOptions.postCommands = args["+c"];
                    dactyl.commandLineOptions.preCommands = args["++cmd"];
                    util.dump("Processing command-line option: " + args.string);
                }
            }
            catch (e) {
                dactyl.echoerr("Parsing command line options: " + e);
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

            if (dactyl.userEval("typeof document", null, "test.js") === "undefined")
                jsmodules.__proto__ = XPCSafeJSObjectWrapper(window);

            if (dactyl.commandLineOptions.preCommands)
                dactyl.commandLineOptions.preCommands.forEach(function (cmd) {
                    dactyl.execute(cmd);
                });

            // finally, read the RC file and source plugins
            let init = services.environment.get(config.idName + "_INIT");
            let rcFile = io.getRCFile("~");

            try {
                if (dactyl.commandLineOptions.rcFile) {
                    let filename = dactyl.commandLineOptions.rcFile;
                    if (!/^(NONE|NORC)$/.test(filename))
                        io.source(io.File(filename).path, { group: contexts.user });
                }
                else {
                    if (init)
                        dactyl.execute(init);
                    else {
                        if (rcFile) {
                            io.source(rcFile.path, { group: contexts.user });
                            services.environment.set("MY_" + config.idName + "RC", rcFile.path);
                        }
                        else
                            dactyl.log("No user RC file found", 3);
                    }

                    if (options["exrc"] && !dactyl.commandLineOptions.rcFile) {
                        let localRCFile = io.getRCFile(io.cwd);
                        if (localRCFile && !localRCFile.equals(rcFile))
                            io.source(localRCFile.path, { group: contexts.user });
                    }
                }

                if (dactyl.commandLineOptions.rcFile == "NONE" || dactyl.commandLineOptions.noPlugins)
                    options["loadplugins"] = [];

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

            if (JSMLoader.rehashCmd)
                dactyl.execute(JSMLoader.rehashCmd);
            JSMLoader.rehashCmd = null;

            dactyl.fullyInitialized = true;
            dactyl.triggerObserver("enter", null);
            autocommands.trigger("Enter", {});
        }, 100);

        statusline.update();
        dactyl.log(config.appName + " fully initialized", 0);
        dactyl.initialized = true;
    }
});

// vim: set fdm=marker sw=4 ts=4 et:
