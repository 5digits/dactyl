// Copyright (c) 2006-2008 by Martin Stubenschrott <stubenschrott@vimperator.org>
// Copyright (c) 2007-2011 by Doug Kearns <dougkearns@gmail.com>
// Copyright (c) 2008-2014 Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

/** @scope modules */

var EVAL_ERROR = "__dactyl_eval_error";
var EVAL_RESULT = "__dactyl_eval_result";
var EVAL_STRING = "__dactyl_eval_string";

var Dactyl = Module("dactyl", XPCOM(Ci.nsISupportsWeakReference, ModuleBase), {
    init: function () {
        window.dactyl = this;
        // cheap attempt at compatibility
        let prop = { get: deprecated("dactyl", function liberator() dactyl),
                     configurable: true };
        Object.defineProperty(window, "liberator", prop);
        Object.defineProperty(modules, "liberator", prop);
        this.commands = {};
        this.indices = {};
        this.modules = modules;
        this._observers = {};
        util.addObserver(this);

        this.commands["dactyl.restart"] = function (event) {
            dactyl.restart();
        };

        styles.registerSheet("resource://dactyl-skin/dactyl.css");

        this.cleanups = [];
        this.cleanups.push(overlay.overlayObject(window, {
            focusAndSelectUrlBar: function focusAndSelectUrlBar() {
                switch (options.get("strictfocus").getKey(document.documentURIObject || util.newURI(document.documentURI), "moderate")) {
                case "laissez-faire":
                    if (!Events.isHidden(window.gURLBar, true))
                        return focusAndSelectUrlBar.superapply(this, arguments);
                default:
                    // Evil. Ignore.
                }
            }
        }));
    },

    cleanup: function () {
        for (let cleanup in values(this.cleanups))
            cleanup.call(this);

        delete window.dactyl;
        delete window.liberator;

        // Prevents box ordering bugs after our stylesheet is removed.
        styles.system.add("cleanup-sheet", config.styleableChrome, literal(function () /*
            #TabsToolbar tab { display: none; }
        */$));
        styles.unregisterSheet("resource://dactyl-skin/dactyl.css");
        DOM('#TabsToolbar tab', document).style.display;
    },

    destroy: function () {
        this.observe.unregister();
        autocommands.trigger("LeavePre", {});
        dactyl.triggerObserver("shutdown", null);
        util.dump("All dactyl modules destroyed\n");
        autocommands.trigger("Leave", {});
    },

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

    observers: {
        "dactyl-cleanup": function dactyl_cleanup(subject, reason) {
            let modules = dactyl.modules;

            for (let mod in values(modules.moduleList.reverse())) {
                mod.stale = true;
                if ("cleanup" in mod)
                    this.trapErrors("cleanup", mod, reason);
                if ("destroy" in mod)
                    this.trapErrors("destroy", mod, reason);
            }

            modules.moduleManager.initDependencies("cleanup");

            for (let name in values(Object.getOwnPropertyNames(modules).reverse()))
                try {
                    delete modules[name];
                }
                catch (e) {}
            modules.__proto__ = {};
        }
    },

    signals: {
        "io.source": function ioSource(context, file, modTime) {
            if (contexts.getDocs(context))
                help.flush("help/plugins.xml", modTime);
        }
    },

    profileName: deprecated("config.profileName", { get: function profileName() config.profileName }),

    /**
     * @property {Modes.Mode} The current main mode.
     * @see modes#mainModes
     */
    mode: deprecated("modes.main", {
        get: function mode() modes.main,
        set: function mode(val) modes.main = val
    }),

    getMenuItems: function getMenuItems(targetPath) {
        function addChildren(node, parent) {
            DOM(node).createContents();

            if (~["menu", "menupopup"].indexOf(node.localName) && node.children.length)
                DOM(node).popupshowing({ bubbles: false });

            for (let [, item] in Iterator(node.childNodes)) {
                if (item.childNodes.length == 0 && item.localName == "menuitem"
                    && !item.hidden
                    && !/rdf:http:/.test(item.getAttribute("label"))) { // FIXME
                    item.dactylPath = parent + item.getAttribute("label");
                    if (!targetPath || targetPath.startsWith(item.dactylPath))
                        items.push(item);
                }
                else {
                    let path = parent;
                    if (item.localName == "menu")
                        path += item.getAttribute("label") + ".";
                    if (!targetPath || targetPath.startsWith(path))
                        addChildren(item, path);
                }
            }
        }

        let items = [];
        addChildren(document.getElementById(config.guioptions["m"][1]), "");
        return items;
    },

    get menuItems() this.getMenuItems(),

    // Global constants
    CURRENT_TAB: "here",
    NEW_TAB: "tab",
    NEW_BACKGROUND_TAB: "background-tab",
    NEW_WINDOW: "window",

    forceBackground: null,
    forcePrivate: null,
    forceTarget: null,

    get forceOpen() ({ background: this.forceBackground,
                       target: this.forceTarget }),
    set forceOpen(val) {
        for (let [k, v] in Iterator({ background: "forceBackground", target: "forceTarget" }))
            if (k in val)
                this[v] = val[k];
    },

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

    registerObserver: function registerObserver(type, callback, weak) {
        if (!(type in this._observers))
            this._observers[type] = [];
        this._observers[type].push(weak ? util.weakReference(callback) : { get: function () callback });
    },

    registerObservers: function registerObservers(obj, prop) {
        for (let [signal, func] in Iterator(obj[prop || "signals"]))
            this.registerObserver(signal, func.bind(obj), false);
    },

    unregisterObserver: function unregisterObserver(type, callback) {
        if (type in this._observers)
            this._observers[type] = this._observers[type].filter(c => c.get() != callback);
    },

    applyTriggerObserver: function triggerObserver(type, args) {
        if (type in this._observers)
            this._observers[type] = this._observers[type]
                                        .filter(callback => {
                callback = callback.get();
                if (callback) {
                    util.trapErrors(() => callback.apply(null, args));
                    return true;
                }
            });
    },

    triggerObserver: function triggerObserver(type, ...args) {
        return this.applyTriggerObserver(type, args);
    },

    addUsageCommand: function (params) {
        function keys(item) (item.names || [item.name]).concat(item.description, item.columns || []);

        let name = commands.add(params.name, params.description,
            function (args) {
                let results = array(params.iterate(args))
                    .sort((a, b) => String.localeCompare(a.name, b.name));

                let filters = args.map(arg => let (re = util.regexp.escape(arg))
                                        util.regexp("\\b" + re + "\\b|(?:^|[()\\s])" + re + "(?:$|[()\\s])", "i"));
                if (filters.length)
                    results = results.filter(item => filters.every(re => keys(item).some(re.bound.test)));

                commandline.commandOutput(
                    template.usage(results, params.format));
            },
            {
                argCount: "*",
                completer: function (context, args) {
                    context.keys.text = util.identity;
                    context.keys.description = function () seen[this.text] + /*L*/" matching items";
                    context.ignoreCase = true;
                    let seen = {};
                    context.completions = array(keys(item).join(" ").toLowerCase().split(/[()\s]+/)
                                                for (item in params.iterate(args)))
                        .flatten()
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
                        .array.sort((a, b) => String.localeCompare(a.name, b.name));

                for (let obj in values(results)) {
                    let res = dactyl.generateHelp(obj, null, null, true);
                    if (!hasOwnProperty(help.tags, obj.helpTag))
                        res[0][1].tag = obj.helpTag;

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
            if (!elems.bell)
                overlay.overlayWindow(window, {
                    objects: elems,
                    prepend: [
                        ["window", { id: document.documentElement.id, xmlns: "xul" },
                            ["hbox", { style: "display: none",  highlight: "Bell", id: "dactyl-bell", key: "bell" }]]],
                    append: [
                        ["window", { id: document.documentElement.id, xmlns: "xul" },
                            ["hbox", { style: "display: none", highlight: "Bell", id: "dactyl-bell-strut", key: "strut" }]]]
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
     * @param {string} which Which clipboard to write to. Either
     *     "global" or "selection". If not provided, both clipboards are
     *     updated.
     *     @optional
     * @returns {string}
     */
    clipboardRead: function clipboardRead(which) {
        try {
            const { clipboard } = services;

            let transferable = services.Transferable();
            transferable.addDataFlavor("text/unicode");

            let source = clipboard[which == "global" || !clipboard.supportsSelectionClipboard() ?
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
     * @param {string} str The string to write.
     * @param {boolean} verbose If true, the user is notified of the copied data.
     * @param {string} which Which clipboard to write to. Either
     *     "global" or "selection". If not provided, both clipboards are
     *     updated.
     *     @optional
     */
    clipboardWrite: function clipboardWrite(str, verbose, which) {
        if (which == null || which == "selection" && !services.clipboard.supportsSelectionClipboard())
            services.clipboardHelper.copyString(str);
        else
            services.clipboardHelper.copyStringToClipboard(str,
                services.clipboard["k" + util.capitalize(which) + "Clipboard"]);

        if (verbose) {
            let message = { message: _("dactyl.yank", str) };
            try {
                message.domains = [util.newURI(str).host];
            }
            catch (e) {};
            dactyl.echomsg(message);
        }
    },

    dump: deprecated("util.dump",
                     { get: function dump() util.bound.dump }),
    dumpStack: deprecated("util.dumpStack",
                          { get: function dumpStack() util.bound.dumpStack }),

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

        if (isinstance(str, ["DOMException", "Error", "Exception", ErrorBase])
                || isinstance(str, ["XPCWrappedNative_NoHelper"]) && /^\[Exception/.test(str))
            dactyl.reportError(str);

        if (isObject(str) && "echoerr" in str)
            str = str.echoerr;
        else if (isinstance(str, ["Error", FailedAssertion]) && str.fileName)
            str = [str.fileName.replace(/^.* -> /, ""), ": ", str.lineNumber, ": ", str].join("");

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
    echomsg: function echomsg(str, verbosity, flags) {
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
    loadScript: function loadScript(uri, context) {
        let prefix = "literal:" + uri + ":";
        cache.flush(s => s.startsWith(prefix));
        delete literal.files[uri];
        JSMLoader.loadSubScript(uri, context, File.defaultEncoding);
    },

    userEval: function userEval(str, context, fileName, lineNumber) {
        let ctxt,
            info = contexts.context;

        if (fileName == null)
            if (info)
                ({ file: fileName, line: lineNumber, context: ctxt }) = info;

        if (fileName && fileName[0] == "[")
            fileName = "dactyl://command-line/";
        else if (!context)
            context = ctxt || userContext;

        if (!context)
            context = userContext || ctxt;

        if (isinstance(context, ["Sandbox"]))
            return Cu.evalInSandbox(str, context, "1.8", fileName, lineNumber);

        if (services.has("dactyl") && services.dactyl.evalInContext)
            return services.dactyl.evalInContext(str, context, fileName, lineNumber);

        try {
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
    userFunc: function userFunc(...args) {
        return this.userEval(
            "(function userFunction(" + args.slice(0, -1).join(", ") + ")" +
            " { " + args.pop() + " })");
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
    execute: function execute(str, modifiers={}, silent=false) {
        // skip comments and blank lines
        if (/^\s*("|$)/.test(str))
            return;

        if (!silent)
            commands.lastCommand = str.replace(/^\s*:\s*/, "");
        let res = true;
        for (let [command, args] in commands.parseCommands(str.replace(/^'(.*)'$/, "$1"))) {
            if (command === null)
                throw FailedAssertion(_("dactyl.notCommand", config.appName, args.commandString));

            res = res && command.execute(args, modifiers);
        }
        return res;
    },

    focus: function focus(elem, flags) {
        DOM(elem).focus(flags);
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
                this.withSavedValues(["ignoreFocus"], function _focusContent() {
                    this.ignoreFocus = true;
                    if (win.frameElement)
                        win.frameElement.blur();
                    // Grr.
                    if (content.document.activeElement instanceof Ci.nsIDOMHTMLIFrameElement)
                        content.document.activeElement.blur();
                });
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
    has: function has(feature) config.has(feature),

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

    help: deprecated("help.help", { get: function help() modules.help.bound.help }),
    findHelp: deprecated("help.findHelp", { get: function findHelp() help.bound.findHelp }),

    /**
     * @private
     * Initialize the help system.
     */
    initHelp: function initHelp() {
        if ("noscriptOverlay" in window)
            window.noscriptOverlay.safeAllow("dactyl:", true, false);

        help.initialize();
    },

    /**
     * Generates a help entry and returns it as a string.
     *
     * @param {Command|Map|Option} obj A dactyl *Command*, *Map* or *Option*
     *     object
     * @param {XMLList} extraHelp Extra help text beyond the description.
     * @returns {string}
     */
    generateHelp: function generateHelp(obj, extraHelp, str, specOnly) {
        let link, tag, spec;
        link = tag = spec = util.identity;
        let args = null;

        if (obj instanceof Command) {
            link = cmd => ["ex", {}, cmd];
            args = obj.parseArgs("", CompletionContext(str || ""));
            tag  = cmd => DOM.DOMString(":" + cmd);
            spec = cmd => [
                obj.count ? ["oa", {}, "count"] : [],
                cmd,
                obj.bang ? ["oa", {}, "!"] : []
            ];
        }
        else if (obj instanceof Map) {
            spec = map => (obj.count ? [["oa", {}, "count"], map]
                                     : DOM.DOMString(map));
            tag = map => [
                let (c = obj.modes[0].char) c ? c + "_" : "",
                map
            ];
            link = map => {
                let [, mode, name, extra] = /^(?:(.)_)?(?:<([^>]+)>)?(.*)$/.exec(map);
                let k = ["k", {}, extra];
                if (name)
                    k[1].name = name;
                if (mode)
                    k[1].mode = mode;
                return k;
            };
        }
        else if (obj instanceof Option) {
            spec = () => template.map(obj.names, tag, " ");
            tag = name => DOM.DOMString("'" + name + "'");
            link = (opt, name) => ["o", {}, name];
            args = { value: "", values: [] };
        }

        let res = [
                ["dt", {}, link(obj.helpTag || tag(obj.name), obj.name)],
                ["dd", {},
                    template.linkifyHelp(obj.description ? obj.description.replace(/\.$/, "") : "", true)]];
        if (specOnly)
            return res;

        let description = ["description", {},
            obj.description ? ["p", {}, template.linkifyHelp(obj.description.replace(/\.?$/, "."), true)] : "",
            extraHelp ? extraHelp : "",
            !(extraHelp || obj.description) ? ["p", {}, /*L*/ "Sorry, no help available."] : ""];

        res.push(
            ["item", {},
                ["tags", {}, template.map(obj.names.slice().reverse(),
                                          tag,
                                          " ").join("")],
                ["spec", {},
                    let (name = (obj.specs || obj.names)[0])
                          spec(template.highlightRegexp(tag(name),
                               /\[(.*?)\]/g,
                               (m, n0) => ["oa", {}, n0]),
                               name)],
                !obj.type ? "" : [
                    ["type", {}, obj.type],
                    ["default", {}, obj.stringDefaultValue]],
                description]);

        function add(ary) {
            description.push(
                ["dl", {}, template.map(ary,
                                        function ([a, b]) [["dt", {}, a], " ",
                                                           ["dd", {}, b]])]);
        }

        if (obj.completer && false)
            add(completion._runCompleter(obj.bound.completer, "", null, args).items
                          .map(i => [i.text, i.description]));

        if (obj.options && obj.options.some(o => o.description) && false)
            add(obj.options.filter(o => o.description)
                   .map(o => [
                        o.names[0],
                        [o.description,
                         o.names.length == 1 ? "" :
                             ["", " (short name: ",
                                 template.map(o.names.slice(1),
                                              n => ["em", {}, n],
                                              ", "),
                              ")"]]
                    ]));

        return DOM.toPrettyXML(res, true, null, { "": String(NS) });
    },

    /**
     * The map of global variables.
     *
     * These are set and accessed with the "g:" prefix.
     */
    _globalVariables: {},
    globalVariables: deprecated(_("deprecated.for.theOptionsSystem"), {
        get: function globalVariables() this._globalVariables
    }),

    loadPlugins: function loadPlugins(args, force) {
        function sourceDirectory(dir) {
            dactyl.assert(dir.isReadable(), _("io.notReadable", dir.path));

            dactyl.log(_("dactyl.sourcingPlugins", dir.path), 3);

            let loadplugins = options.get("loadplugins");
            if (args)
                loadplugins = { __proto__: loadplugins, value: args.map(Option.parseRegexp) };

            dir.readDirectory(true).forEach(function (file) {
                if (file.leafName[0] == ".")
                    ;
                else if (file.isFile() && loadplugins.getKey(file.path)
                        && !(!force && file.path in dactyl.pluginFiles && dactyl.pluginFiles[file.path] >= file.lastModifiedTime)) {
                    try {
                        io.source(file.path);
                        dactyl.pluginFiles[file.path] = file.lastModifiedTime;
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
            dactyl.log(_("dactyl.noPluginDir"), 3);
            return;
        }

        dactyl.echomsg(
            _("plugin.searchingForIn",
                ("plugins/**/*.{js," + config.fileExtension + "}").quote(),
                [dir.path.replace(/.plugins$/, "") for ([, dir] in Iterator(dirs))]
                    .join(",").quote()),
            2);

        dirs.forEach(function (dir) {
            dactyl.echomsg(_("plugin.searchingFor", (dir.path + "/**/*.{js," + config.fileExtension + "}").quote()), 3);
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
    log: function log(msg, level) {
        let verbose = config.prefs.get("loglevel", 0);

        if (!level || level <= verbose) {
            if (isObject(msg) && !isinstance(msg, _))
                msg = util.objectToString(msg, false);

            services.console.logStringMessage(config.name + ": " + msg);
        }
    },

    events: {
        beforecustomization: function onbeforecustomization(event) {
            // Show navigation bar on Australis, where it's not supposed
            // to be collapsible, and is therefore not handled by
            // builtin code.
            if ("CustomizableUI" in window)
                this.setNodeVisible(document.getElementById("nav-bar"),
                                    true);
        },

        aftercustomization: function onaftercustomization(event) {
            // Restore toolbar states.
            options["guioptions"] = options["guioptions"];
        },

        click: function onClick(event) {
            let elem = event.originalTarget;

            if (elem instanceof Element && services.security.isSystemPrincipal(elem.nodePrincipal)) {
                let command = elem.getAttributeNS(NS, "command");
                if (command && event.button == 0) {
                    event.preventDefault();

                    if (dactyl.commands[command])
                        dactyl.withSavedValues(["forceTarget"], function () {
                            if (event.ctrlKey || event.shiftKey || event.button == 1)
                                dactyl.forceTarget = dactyl.NEW_TAB;
                            dactyl.commands[command](event);
                        });
                }
            }
        },

        "dactyl.execute": function onExecute(event) {
            let cmd = event.originalTarget.getAttribute("dactyl-execute");
            commands.execute(cmd, null, false, null,
                             { file: /*L*/"[Command Line]", line: 1 });
        }
    },

    /**
     * Opens one or more URLs. Returns true when load was initiated, or
     * false on error.
     *
     * @param {string|Array} urls A representation of the URLs to open.
     *     A string will be passed to {@link Dactyl#parseURLs}. An array may
     *     contain elements of the following forms:
     *
     *      • {string}                    A URL to open.
     *      • {[string, {string|Array}]}  Pair of a URL and POST data.
     *      • {object}                    Object compatible with those returned
     *                                    by {@link DOM#formData}.
     *
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
    open: function open(urls, params={}, force=false) {
        if (typeof urls == "string")
            urls = dactyl.parseURLs(urls);

        if (urls.length > prefs.get("browser.tabs.maxOpenBeforeWarn", 20) && !force)
            return commandline.input(_("dactyl.prompt.openMany", urls.length) + " ")
                .then(function (resp) {
                    if (resp && resp.match(/^y(es)?$/i))
                        dactyl.open(urls, params, true);
                });

        if (isString(params))
            params = { where: params };

        let flags = 0;
        for (let [opt, flag] in Iterator({ replace: "REPLACE_HISTORY", hide: "BYPASS_HISTORY" }))
            flags |= params[opt] && Ci.nsIWebNavigation["LOAD_FLAGS_" + flag];

        let where = params.where || dactyl.CURRENT_TAB;
        let background = dactyl.forceBackground != null ? dactyl.forceBackground :
                         ("background" in params)       ? params.background
                                                        : params.where == dactyl.NEW_BACKGROUND_TAB;

        if (params.from && dactyl.has("tabs")) {
            if (!params.where && options.get("newtab").has(params.from))
                where = dactyl.NEW_TAB;
            background ^= !options.get("activate").has(params.from);
        }

        if (urls.length == 0)
            return;

        let browser = config.tabbrowser;
        function open(loc, where) {
            try {
                if (isArray(loc))
                    loc = { url: loc[0], postData: loc[1] };
                else if (isString(loc))
                    loc = { url: loc };
                else
                    loc = Object.create(loc);

                if (isString(loc.postData))
                    loc.postData = ["application/x-www-form-urlencoded", loc.postData];

                if (isArray(loc.postData)) {
                    let stream = services.MIMEStream(services.StringStream(loc.postData[1]));
                    stream.addHeader("Content-Type", loc.postData[0]);
                    stream.addContentLength = true;
                    loc.postData = stream;
                }

                // decide where to load the first url
                switch (where) {

                case dactyl.NEW_TAB:
                    if (!dactyl.has("tabs"))
                        return open(loc, dactyl.NEW_WINDOW);

                    return prefs.withContext(function () {
                        prefs.set("browser.tabs.loadInBackground", true);
                        return browser.loadOneTab(loc.url, null, null, loc.postData, background).linkedBrowser.contentDocument;
                    });

                case dactyl.NEW_WINDOW:
                    let options = ["chrome", "all", "dialog=no"];
                    if (dactyl.forcePrivate)
                        options.push("private");

                    let win = window.openDialog(document.documentURI, "_blank", options.join(","));
                    util.waitFor(() => win.document.readyState === "complete");
                    browser = win.dactyl && win.dactyl.modules.config.tabbrowser || win.getBrowser();
                    // FALLTHROUGH
                case dactyl.CURRENT_TAB:
                    browser.loadURIWithFlags(loc.url, flags, null, null, loc.postData);
                    return browser.contentWindow;
                }
            }
            catch (e) {}
            // Unfortunately, failed page loads throw exceptions and
            // cause a lot of unwanted noise. This solution means that
            // any genuine errors go unreported.
        }

        if (dactyl.forceTarget)
            where = dactyl.forceTarget;
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
     * @returns {[string]}
     */
    parseURLs: function parseURLs(str) {
        let urls;

        if (options["urlseparator"])
            urls = util.splitLiteral(str, util.regexp("\\s*" + options["urlseparator"] + "\\s*"));
        else
            urls = [str];

        return urls.map(function (url) {
            url = url.trim();

            if (/^(\.{0,2}|~)(\/|$)/.test(url) || config.OS.isWindows && /^[a-z]:/i.test(url)) {
                try {
                    // Try to find a matching file.
                    let file = io.File(url);
                    if (file.exists() && file.isReadable())
                        return file.URI.spec;
                }
                catch (e) {}
            }

            // If it starts with a valid protocol, pass it through.
            let proto = /^([-\w]+):/.exec(url);
            if (proto && services.PROTOCOL + proto[1] in Cc)
                return url;

            // Check for a matching search keyword.
            let searchURL = this.has("bookmarks") && bookmarks.getSearchURL(url, false);
            if (searchURL)
                return searchURL;

            // If it looks like URL-ish (foo.com/bar), let Gecko figure it out.
            if (this.urlish.test(url) || !this.has("bookmarks"))
                return util.createURI(url).spec;

            // Pass it off to the default search engine or, failing
            // that, let Gecko deal with it as is.
            return bookmarks.getSearchURL(url, true) || util.createURI(url).spec;
        }, this);
    },
    stringToURLArray: deprecated("dactyl.parseURLs", "parseURLs"),
    urlish: Class.Memoize(() => util.regexp(literal(function () /*
            ^ (
                <domain>+ (:\d+)? (/ .*) |
                <domain>+ (:\d+) |
                <domain>+ \. [a-z0-9]+ |
                localhost
            ) $
        */$), "ix", {
        domain: util.regexp(String.replace(literal(function () /*
            [^
                U0000-U002c // U002d-U002e --.
                U002f       // /
                            // U0030-U0039 0-9
                U003a-U0040 // U0041-U005a a-z
                U005b-U0060 // U0061-U007a A-Z
                U007b-U007f
            ]
        */$), /U/g, "\\u"), "x")
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
    quit: function quit(saveSession, force) {
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
    restart: function restart(args) {
        if (!this.confirmQuit())
            return;

        config.prefs.set("commandline-args", args);

        services.appStartup.quit(Ci.nsIAppStartup.eAttemptQuit | Ci.nsIAppStartup.eRestart);
    },

    get assert() util.assert,

    /**
     * Traps errors in the called function, possibly reporting them.
     *
     * @param {function} func The function to call
     * @param {object} self The 'this' object for the function.
     */
    trapErrors: function trapErrors(func, self, ...args) {
        try {
            if (isString(func))
                func = self[func];
            return func.apply(self || this, args);
        }
        catch (e) {
            try {
                dactyl.reportError(e, true);
            }
            catch (e) {
                util.reportError(e);
            }
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
        if (error instanceof FailedAssertion && error.noTrace || error.message === "Interrupted") {
            let context = contexts.context;
            let prefix = context ? context.file + ":" + context.line + ": " : "";
            if (error.message && !error.message.startsWith(prefix) &&
                    prefix != "[Command Line]:1: ")
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
        else
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
    parseCommandLine: function parseCommandLine(cmdline) {
        try {
            return commands.get("rehash").parseArgs(cmdline);
        }
        catch (e) {
            dactyl.reportError(e, true);
            return [];
        }
    },
    wrapCallback: function wrapCallback(callback, self=this) {
        let save = ["forceOpen"];
        let saved = save.map(p => dactyl[p]);
        return function wrappedCallback() {
            let args = arguments;
            return dactyl.withSavedValues(save, function () {
                saved.forEach((p, i) => { dactyl[save[i]] = p; });
                try {
                    return callback.apply(self, args);
                }
                catch (e) {
                    dactyl.reportError(e, true);
                }
            });
        };
    },

    /**
     * @property {[Window]} Returns an array of all the host application's
     *     open windows.
     */
    get windows() [w for (w of overlay.windows)]

}, {
    toolbarHidden: function toolbarHidden(elem) "true" == (elem.getAttribute("autohide") ||
                                                           elem.getAttribute("collapsed"))
}, {
    cache: function initCache() {
        cache.register("help/plugins.xml", function () {
            // Process plugin help entries.

            let body = [];
            for (let [, context] in Iterator(plugins.contexts))
                try {
                    let info = contexts.getDocs(context);
                    if (DOM.isJSONXML(info)) {
                        let langs = info.slice(2)
                                        .filter(e => isArray(e) && isObject(e[1]) && e[1].lang);
                        if (langs) {
                            let lang = config.bestLocale(langs.map(l => l[1].lang));

                            info = info.slice(0, 2).concat(
                                info.slice(2).filter(e => !isArray(e)
                                                       || !isObject(e[1])
                                                       || e[1].lang == lang));

                            info.slice(2)
                                .filter(e => isArray(e) && e[0] == "info" && isObject(e[1]))
                                .forEach(elem => {
                                for (let attr of ["name", "summary", "href"])
                                    if (attr in elem[1])
                                        info[attr] = elem[1][attr];
                            });
                        }
                        body.push(["h2", { xmlns: "dactyl", tag: info[1].name + '-plugin' },
                                       String(info[1].summary)]);
                        body.push(info);
                    }
                }
                catch (e) {
                    util.reportError(e);
                }

            return '<?xml version="1.0"?>\n' +
                   '<?xml-stylesheet type="text/xsl" href="dactyl://content/help.xsl"?>\n' +
                   DOM.toXML(
                       ["document", { xmlns: "dactyl", name: "plugins",
                                      title: config.appName + ", Plugins" },
                           ["h1", { tag: "using-plugins" }, _("help.title.Using Plugins")],
                           ["toc", { start: "2" }],

                           body]);
        }, true);

        cache.register("help/index.xml", function () {
            return '<?xml version="1.0"?>\n' +
                   DOM.toXML(["overlay", { xmlns: "dactyl" },
                       template.map(dactyl.indices, ([name, iter]) =>
                           ["dl", { insertafter: name + "-index" },
                               template.map(iter(), util.identity)],
                           "\n\n")]);
        }, true);

        cache.register("help/gui.xml", function () {
            return '<?xml version="1.0"?>\n' +
                   DOM.toXML(["overlay", { xmlns: "dactyl" },
                       ["dl", { insertafter: "dialog-list" },
                           template.map(config.dialogs, ([name, val]) =>
                               (!val[2] || val[2]())
                                   ? [["dt", {}, name],
                                      ["dd", {}, val[0]]]
                                   : undefined,
                               "\n")]]);
        }, true);

        cache.register("help/privacy.xml", function () {
            return '<?xml version="1.0"?>\n' +
                   DOM.toXML(["overlay", { xmlns: "dactyl" },
                       ["dl", { insertafter: "sanitize-items" },
                           template.map(options.get("sanitizeitems").values
                                                .sort((a, b) => String.localeCompare(a.name,
                                                                                     b.name)),
                               ({ name, description }) =>
                               [["dt", {}, name],
                                ["dd", {}, template.linkifyHelp(description, true)]],
                               "\n")]]);
        }, true);
    },
    events: function initEvents() {
        events.listen(window, dactyl, "events", true);
    },
    // Only general options are added here, which are valid for all Dactyl extensions
    options: function initOptions() {
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
                    if (loaded.has("commandline") || ~opts.indexOf("c"))
                        commandline.widgets.updateVisibility();
                }
            },
            {
                opts: update({
                    s: ["Status bar", [statusline.statusBar.id]]
                }, config.guioptions),
                setter: function (opts) {
                    for (let [opt, [, ids]] in Iterator(this.opts)) {
                        ids.map(id => document.getElementById(id))
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
                        dir => !Array.some(opts,
                                           o => this.opts[o] && this.opts[o][1] == dir));
                    let class_ = dir.map(dir => "html|html > xul|scrollbar[orient=" + dir + "]");

                    styles.system.add("scrollbar", "*",
                                      class_.length ? class_.join(", ") + " { visibility: collapse !important; }" : "",
                                      true);

                    prefs.safeSet("layout.scrollbar.side", opts.indexOf("l") >= 0 ? 3 : 2,
                                  _("option.guioptions.safeSet"));
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

                    if (config.tabbrowser.tabContainer._positionPinnedTabs)
                        config.tabbrowser.tabContainer._positionPinnedTabs();
                },
                /*
                validator: function (opts) dactyl.has("Gecko2") ||
                    Option.validIf(!/[nN]/.test(opts), "Tab numbering not available in this " + config.host + " version")
                 */
            }
        ].filter(group => !group.feature || dactyl.has(group.feature));

        options.add(["guioptions", "go"],
            "Show or hide certain GUI elements like the menu or toolbar",
            "charlist", "", {

                // FIXME: cleanup
                cleanupValue: config.cleanups.guioptions ||
                    "rb" + [k for ([k, v] in iter(groups[1].opts))
                            if (!Dactyl.toolbarHidden(document.getElementById(v[1][0])))].join(""),

                values: array(groups).map(g => [[k, v[0]] for ([k, v] in Iterator(g.opts))])
                                     .flatten(),

                setter: function (value) {
                    for (let group in values(groups))
                        group.setter(value);
                    events.checkFocus();
                    return value;
                },
                validator: function (val) Option.validateCompleter.call(this, val)
                                       && groups.every(g => !g.validator || g.validator(val))
            });

        options.add(["loadplugins", "lpl"],
            "A regexp list that defines which plugins are loaded at startup and via :loadplugins",
            "regexplist", "'\\.(js|" + config.fileExtension + ")$'");

        options.add(["titlestring"],
            "The string shown at the end of the window title",
            "string", config.host,
            {
                setter: function (value) {
                    let win = document.documentElement;
                    function updateTitle(old, current) {
                        if (config.browser.updateTitlebar)
                            config.browser.updateTitlebar();
                        else
                            document.title = document.title.replace(RegExp("(.*)" + util.regexp.escape(old)), "$1" + current);
                    }

                    if (win.hasAttribute("titlemodifier_privatebrowsing")) {
                        let oldValue = win.getAttribute("titlemodifier_normal");
                        let suffix = win.getAttribute("titlemodifier_privatebrowsing").substr(oldValue.length);

                        win.setAttribute("titlemodifier_normal", value);
                        win.setAttribute("titlemodifier_privatebrowsing", value + suffix);

                        if (storage.privateMode) {
                            updateTitle(oldValue + suffix, value + suffix);
                            win.setAttribute("titlemodifier", value + suffix);
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
            "string", " \\| ",
            { validator: function (value) RegExp(value) });

        options.add(["verbose", "vbs"],
            "Define which info messages are displayed",
            "number", 1,
            { validator: function (value) Option.validIf(value >= 0 && value <= 15,
                                                         "Value must be between 0 and 15") });

        options.add(["visualbell", "vb"],
            "Use visual bell instead of beeping on errors",
            "boolean", false,
            {
                setter: function (value) {
                    prefs.safeSet("accessibility.typeaheadfind.enablesound", !value,
                                  _("option.safeSet", "visualbell"));
                    return value;
                }
            });
    },

    mappings: function initMappings() {
        if (dactyl.has("session"))
            mappings.add([modes.NORMAL], ["ZQ"],
                "Quit and don't save the session",
                function () { dactyl.quit(false); });

        mappings.add([modes.NORMAL], ["ZZ"],
            "Quit and save the session",
            function () { dactyl.quit(true); });
    },

    commands: function initCommands() {
        commands.add(["dia[log]"],
            "Open a " + config.appName + " dialog",
            function (args) {
                let dialog = args[0];

                dactyl.assert(dialog in config.dialogs,
                              _("error.invalidArgument", dialog));
                dactyl.assert(!config.dialogs[dialog][2] || config.dialogs[dialog][2](),
                              _("dialog.notAvailable", dialog));
                try {
                    config.dialogs[dialog][1]();
                }
                catch (e) {
                    dactyl.echoerr(_("error.cantOpen", dialog.quote(), e.message || e));
                }
            }, {
                argCount: "1",
                completer: function (context) {
                    context.ignoreCase = true;
                    completion.dialog(context);
                }
            });

        commands.add(["em[enu]"],
            "Execute the specified menu item from the command line",
            function (args) {
                let arg = args[0] || "";
                let items = dactyl.getMenuItems(arg);

                dactyl.assert(items.some(i => i.dactylPath == arg),
                              _("emenu.notFound", arg));

                for (let [, item] in Iterator(items)) {
                    if (item.dactylPath == arg) {
                        dactyl.assert(!item.disabled, _("error.disabled", item.dactylPath));
                        item.doCommand();
                    }
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

        commands.add(["loadplugins", "lpl"],
            "Load all or matching plugins",
            function (args) {
                dactyl.loadPlugins(args.length ? args : null, args.bang);
            },
            {
                argCount: "*",
                bang: true,
                keepQuotes: true,
                serialGroup: 10,
                serialize: function () [
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

        commands.add(["pr[ivate]", "pr0n", "porn"],
            "Enable privacy features of a command, when applicable, and do not save the invocation in command history",
            function (args) {
                dactyl.withSavedValues(["forcePrivate"], function () {
                    this.forcePrivate = true;
                    dactyl.execute(args[0], null, true);
                });
            }, {
                argCount: "1",
                completer: function (context) completion.ex(context),
                literal: 0,
                privateData: "never-save",
                subCommand: 0
            });

        commands.add(["exit", "x"],
            "Quit " + config.appName,
            function (args) {
                dactyl.quit(false, args.bang);
            }, {
                argCount: "0",
                bang: true
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

        let startupOptions = [
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
            },
            {
                names: ["+purgecaches"],
                description: "Purge " + config.appName + " caches at startup",
                type: CommandOption.NOARG
            }
        ];

        commands.add(["reh[ash]"],
            "Reload the " + config.appName + " add-on",
            function (args) {
                if (args.trailing)
                    storage.storeForSession("rehashCmd", args.trailing); // Hack.
                args.break = true;

                if (args["+purgecaches"])
                    cache.flush();

                util.delay(() => { util.rehash(args) });
            },
            {
                argCount: "0", // FIXME
                options: startupOptions
            });

        commands.add(["res[tart]"],
            "Force " + config.host + " to restart",
            function (args) {
                if (args["+purgecaches"])
                    cache.flush();

                dactyl.restart(args.string);
            },
            {
                argCount: "0",
                options: startupOptions
            });

        function findToolbar(name) DOM.XPath(
            "//*[@toolbarname=" + util.escapeString(name, "'") + " or " +
                "@toolbarname=" + util.escapeString(name.trim(), "'") + "]",
            document).snapshotItem(0);

        var toolbox = document.getElementById("navigator-toolbox");
        if (toolbox) {
            let toolbarCommand = function (names, desc, action, filter) {
                commands.add(names, desc,
                    function (args) {
                        let toolbar = findToolbar(args[0] || "");
                        dactyl.assert(toolbar, _("error.invalidArgument"));
                        action(toolbar);
                        events.checkFocus();
                    }, {
                        argCount: "1",
                        completer: function (context) {
                            completion.toolbar(context);
                            if (filter)
                                context.filters.push(filter);
                        },
                        literal: 0
                    });
            };

            toolbarCommand(["toolbars[how]", "tbs[how]"], "Show the named toolbar",
                toolbar => dactyl.setNodeVisible(toolbar, true),
                ({ item }) => Dactyl.toolbarHidden(item));
            toolbarCommand(["toolbarh[ide]", "tbh[ide]"], "Hide the named toolbar",
                toolbar => dactyl.setNodeVisible(toolbar, false),
                ({ item }) => !Dactyl.toolbarHidden(item));
            toolbarCommand(["toolbart[oggle]", "tbt[oggle]"], "Toggle the named toolbar",
                toolbar => dactyl.setNodeVisible(toolbar, Dactyl.toolbarHidden(toolbar)));
        }

        commands.add(["time"],
            "Profile a piece of code or run a command multiple times",
            function (args) {
                let count = args.count;
                let special = args.bang;
                args = args[0] || "";

                if (args[0] == ":")
                    var func = () => commands.execute(args, null, false);
                else
                    func = dactyl.userFunc(args);

                try {
                    if (count > 1) {
                        let each, eachUnits, totalUnits;
                        let total = 0;

                        for (let i in util.interruptibleRange(0, count, 500)) {
                            let now = Date.now();
                            func();
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
                                ["table", {}
                                    ["tr", { highlight: "Title", align: "left" },
                                        ["th", { colspan: "3" }, _("title.Code execution summary")]],
                                    ["tr", {},
                                        ["td", {}, _("title.Executed"), ":"],
                                        ["td", { align: "right" },
                                            ["span", { class: "times-executed" }, count]],
                                        ["td", {}, /*L*/"times"]],
                                    ["tr", {},
                                        ["td", {}, _("title.Average time"), ":"],
                                        ["td", { align: "right" },
                                            ["span", { class: "time-average" }, each.toFixed(2)]],
                                        ["td", {}, eachUnits]],
                                    ["tr", {},
                                        ["td", {}, _("title.Total time"), ":"],
                                        ["td", { align: "right" },
                                            ["span", { class: "time-total" }, total.toFixed(2)]],
                                        ["td", {}, totalUnits]]]);
                    }
                    else {
                        let beforeTime = Date.now();
                        func();

                        if (special)
                            return;

                        let afterTime = Date.now();

                        if (afterTime - beforeTime >= 100)
                            dactyl.echo(_("time.total", ((afterTime - beforeTime) / 1000.0).toFixed(2) + " sec"));
                        else
                            dactyl.echo(_("time.total", (afterTime - beforeTime) + " msec"));
                    }
                }
                catch (e) {
                    dactyl.echoerr(e);
                }
            }, {
                argCount: "1",
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
                argCount: "1",
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
                else {
                    let date = config.buildDate;
                    date = date ? " (" + date + ")" : "";

                    commandline.commandOutput([
                        ["div", {}, [config.appName, " ", config.version, date, " running on: "].join("")],
                        ["div", {}, [window.navigator.userAgent].join("")]
                    ]);
                }
            }, {
                argCount: "0",
                bang: true
            });

    },

    completion: function initCompletion() {
        completion.dialog = function dialog(context) {
            context.title = ["Dialog"];
            context.filters.push(({ item }) => !item[2] || item[2]());
            context.completions = [[k, v[0], v[2]] for ([k, v] in Iterator(config.dialogs))];
        };

        completion.menuItem = function menuItem(context) {
            context.title = ["Menu Path", "Label"];
            context.anchored = false;
            context.keys = {
                text: "dactylPath",
                description: function (item) item.getAttribute("label"),
                highlight: function (item) item.disabled ? "Disabled" : ""
            };
            context.generate = () => dactyl.menuItems;
        };

        var toolbox = document.getElementById("navigator-toolbox");
        completion.toolbar = function toolbar(context) {
            context.title = ["Toolbar"];
            context.keys = { text: function (item) item.getAttribute("toolbarname"), description: function () "" };
            context.completions = DOM.XPath("//*[@toolbarname]", document);
        };

        completion.window = function window(context) {
            context.title = ["Window", "Title"];
            context.keys = { text: win => dactyl.windows.indexOf(win) + 1,
                             description: win => win.document.title };
            context.completions = dactyl.windows;
        };
    },
    load: function initLoad() {
        dactyl.triggerObserver("load");

        dactyl.log(_("dactyl.modulesLoaded"), 3);

        userContext.DOM = Class("DOM", DOM, { init: function DOM_(sel, ctxt) DOM(sel, ctxt || buffer.focusedFrame.document) });
        userContext.$ = modules.userContext.DOM;

        // Hack: disable disabling of Personas in private windows.
        let root = document.documentElement;

        if (PrivateBrowsingUtils && PrivateBrowsingUtils.isWindowPrivate(window)
                && root._lightweightTheme
                && root._lightweightTheme._lastScreenWidth == null) {

            dactyl.withSavedValues.call(PrivateBrowsingUtils,
                                        ["isWindowPrivate"], function () {
                PrivateBrowsingUtils.isWindowPrivate = () => false;
                Cu.import("resource://gre/modules/LightweightThemeConsumer.jsm", {})
                  .LightweightThemeConsumer.call(root._lightweightTheme, document);
            });
        }

        if (config.has("default-theme") && "CustomizableUI" in window &&
                config.tabbrowser.tabContainer.orient != "vertical")
            overlay.overlayWindow(window, {
                append: [
                    ["window", { id: document.documentElement.id, "dactyl-australis": "true", xmlns: "xul" }]]
            });

        dactyl.timeout(function () {
            try {
                var args = config.prefs.get("commandline-args")
                        || storage.session.commandlineArgs
                        || services.commandLineHandler.optionValue;

                config.prefs.reset("commandline-args");

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
                dactyl.echoerr(_("dactyl.parsingCommandLine", e));
            }

            dactyl.log(_("dactyl.commandlineOpts", util.objectToString(dactyl.commandLineOptions)), 3);

            if (config.prefs.get("first-run", true))
                dactyl.timeout(function () {
                    config.prefs.set("first-run", false);
                    this.withSavedValues(["forceTarget"], function () {
                        this.forceTarget = dactyl.NEW_TAB;
                        help.help();
                    });
                }, 1000);

            // TODO: we should have some class where all this guioptions stuff fits well
            // dactyl.hideGUI();

            if (dactyl.userEval("typeof document", null, "test.js") === "undefined")
                jsmodules.__proto__ = window;

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
                            dactyl.log(_("dactyl.noRCFile"), 3);
                    }

                    if (options["exrc"] && !dactyl.commandLineOptions.rcFile) {
                        let localRCFile = io.getRCFile(io.cwd);
                        if (localRCFile && !localRCFile.equals(rcFile))
                            io.source(localRCFile.path, { group: contexts.user });
                    }
                }

                if (dactyl.commandLineOptions.rcFile == "NONE" || dactyl.commandLineOptions.noPlugins)
                    options["loadplugins"] = [];

                if (options["loadplugins"].length)
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

            if (storage.session.rehashCmd)
                dactyl.execute(storage.session.rehashCmd);
            storage.session.rehashCmd = null;

            dactyl.fullyInitialized = true;
            dactyl.triggerObserver("enter", null);
            autocommands.trigger("Enter", {});
        }, 100);

        statusline.update();
        dactyl.log(_("dactyl.initialized", config.appName), 0);
        dactyl.initialized = true;
    }
});

// vim: set fdm=marker sw=4 sts=4 ts=8 et:
