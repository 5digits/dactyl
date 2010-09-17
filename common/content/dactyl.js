// Copyright (c) 2006-2008 by Martin Stubenschrott <stubenschrott@vimperator.org>
// Copyright (c) 2007-2009 by Doug Kearns <dougkearns@gmail.com>
// Copyright (c) 2008-2009 by Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

/** @scope modules */

default xml namespace = XHTML;
XML.ignoreWhitespace = false;
XML.prettyPrinting = false;

const plugins = { __proto__: modules };
const userContext = { __proto__: modules };

const EVAL_ERROR = "__dactyl_eval_error";
const EVAL_RESULT = "__dactyl_eval_result";
const EVAL_STRING = "__dactyl_eval_string";

const FailedAssertion = Class("FailedAssertion", Error, {
    init: function (message) {
        this.message = message;
    }
});

const Dactyl = Module("dactyl", {
    init: function () {
        window.dactyl = this;
        window.liberator = this;
        modules.liberator = this;
        this.observers = {};
        this.modules = modules;

        // NOTE: services.get("profile").selectedProfile.name doesn't return
        // what you might expect. It returns the last _actively_ selected
        // profile (i.e. via the Profile Manager or -P option) rather than the
        // current profile. These will differ if the current process was run
        // without explicitly selecting a profile.
        /** @property {string} The name of the current user profile. */
        this.profileName = services.get("directory").get("ProfD", Ci.nsIFile).leafName.replace(/^.+?\./, "");
    },

    destroy: function () {
        autocommands.trigger("LeavePre", {});
        storage.saveAll();
        dactyl.triggerObserver("shutdown", null);
        dactyl.dump("All dactyl modules destroyed\n");
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
    version: "@VERSION@ (created: @DATE@)", // these VERSION and DATE tokens are replaced by the Makefile

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

    registerObserver: function (type, callback) {
        if (!(type in this.observers))
            this.observers[type] = [];
        this.observers[type].push(callback);
    },

    unregisterObserver: function (type, callback) {
        if (type in this.observers)
            this.observers[type] = this.observers[type].filter(function (c) c != callback);
    },

    // TODO: "zoom": if the zoom value of the current buffer changed
    triggerObserver: function (type) {
        let args = Array.slice(arguments, 1);
        for (let [, func] in Iterator(this.observers[type] || []))
            func.apply(null, args);
    },

    /**
     * Triggers the application bell to notify the user of an error. The
     * bell may be either audible or visual depending on the value of the
     * 'visualbell' option.
     */
    beep: requiresMainThread(function () {
        // FIXME: popups clear the command line
        if (options["visualbell"]) {
            // flash the visual bell
            let popup = document.getElementById("dactyl-visualbell");
            let win = config.visualbellWindow;
            let rect = win.getBoundingClientRect();
            let width = rect.right - rect.left;
            let height = rect.bottom - rect.top;

            // NOTE: this doesn't seem to work in FF3 with full box dimensions
            popup.openPopup(win, "overlap", 1, 1, false, false);
            popup.sizeTo(width - 2, height - 2);
            util.timeout(function () { popup.hidePopup(); }, 20);
        }
        else {
            let soundService = Cc["@mozilla.org/sound;1"].getService(Ci.nsISound);
            soundService.beep();
        }
    }),

    /**
     * Reads a string from the system clipboard.
     *
     * This is same as Firefox's readFromClipboard function, but is needed for
     * apps like Thunderbird which do not provide it.
     *
     * @returns {string}
     */
    clipboardRead: function clipboardRead() {
        let str;

        try {
            const clipboard = Cc["@mozilla.org/widget/clipboard;1"].getService(Ci.nsIClipboard);
            const transferable = Cc["@mozilla.org/widget/transferable;1"].createInstance(Ci.nsITransferable);

            transferable.addDataFlavor("text/unicode");

            if (clipboard.supportsSelectionClipboard())
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
     * Copies a string to the system clipboard. If <b>verbose</b> is specified
     * the copied string is also echoed to the command line.
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

    /**
     * Prints a message to the console. If <b>msg</b> is an object it is
     * pretty printed.
     *
     * NOTE: the "browser.dom.window.dump.enabled" preference needs to be
     * set.
     *
     * @param {string|Object} msg The message to print.
     */
    dump: function () {
        let msg = Array.map(arguments, function (msg) {
            if (typeof msg == "object")
                msg = util.objectToString(msg);
            return msg;
        }).join(", ");
        msg = String.replace(msg, /\n?$/, "\n");
        window.dump(msg.replace(/^./gm, ("config" in modules && config.name.toLowerCase()) + ": $&"));
    },

    /**
     * Dumps a stack trace to the console.
     *
     * @param {string} msg The trace message.
     * @param {number} frames The number of frames to print.
     */
    dumpStack: function (msg, frames) {
        let stack = Error().stack.replace(/(?:.*\n){2}/, "");
        if (frames != null)
            [stack] = stack.match(RegExp("(?:.*\n){0," + frames + "}"));
        dactyl.dump((msg || "Stack") + "\n" + stack + "\n");
    },

    /**
     * Outputs a plain message to the command line.
     *
     * @param {string} str The message to output.
     * @param {number} flags These control the multiline message behaviour.
     *     See {@link CommandLine#echo}.
     */
    echo: function (str, flags) {
        commandline.echo(str, commandline.HL_NORMAL, flags);
    },

    // TODO: Vim replaces unprintable characters in echoerr/echomsg
    /**
     * Outputs an error message to the command line.
     *
     * @param {string} str The message to output.
     * @param {number} flags These control the multiline message behaviour.
     *     See {@link CommandLine#echo}.
     */
    echoerr: function (str, flags) {
        flags |= commandline.APPEND_TO_MESSAGES;

        if (isinstance(str, ["Error", "Exception"]))
            dactyl.reportError(str);
        if (typeof str == "object" && "echoerr" in str)
            str = str.echoerr;
        else if (isinstance(str, ["Error"]))
            str = str.fileName + ":" + str.lineNumber + ": " + str;

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
     *     'verbosity' option will be output.
     * @param {number} flags These control the multiline message behaviour.
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
     * Loads and executes the script referenced by <b>uri</b> in the scope
     * of the <b>context</b> object.
     *
     * @param {string} uri The URI of the script to load. Should be a local
     *     chrome:, file:, or resource: URL.
     * @param {Object} context The context object into which the script
     *     should be loaded.
     */
    loadScript: function (uri, context) {
        XML.ignoreWhiteSpace = false;
        XML.prettyPrinting = false;
        services.get("subscriptLoader").loadSubScript(uri, context);
    },

    usereval: function (str, context) {
        try {
            if (!context)
                context = userContext;
            context[EVAL_ERROR] = null;
            context[EVAL_STRING] = str;
            context[EVAL_RESULT] = null;
            this.loadScript("chrome://dactyl/content/eval.js", context);
            if (context[EVAL_ERROR]) {
                try {
                    context[EVAL_ERROR].fileName = io.sourcing.file;
                    context[EVAL_ERROR].lineNumber += io.sourcing.line;
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
    userfunc: function () {
        return this.userEval(
            "(function (" +
            Array.slice(arguments, 0, -1).join(", ") +
            ") { " + arguments[arguments.length - 1] + " })")
    },

    // partial sixth level expression evaluation
    // TODO: what is that really needed for, and where could it be used?
    //       Or should it be removed? (c) Viktor
    //       Better name?  See other dactyl.usereval()
    //       I agree, the name is confusing, and so is the
    //           description --Kris
    evalExpression: function (string) {
        string = string.toString().replace(/^\s*/, "").replace(/\s*$/, "");

        let matches = string.match(/^&(\w+)/);
        if (matches) {
            let opt = this.options.get(matches[1]);

            dactyl.assert(opt, "E113: Unknown option: " + matches[1]);

            let type = opt.type;
            let value = opt.getter();

            if (type != "boolean" && type != "number")
                value = value.toString();

            return value;
        }
        // String
        else if ((matches = string.match(/^(['"])([^\1]*?[^\\]?)\1/))) {
            return matches[2].toString();
        }
        // Number
        else if ((matches = string.match(/^(\d+)$/)))
            return parseInt(matches[1], 10);

        let reference = this.variableReference(string);

        if (!reference[0])
            this.echoerr("E121: Undefined variable: " + string);
        else
            return reference[0][reference[1]];
        return null;
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

        let err = null;
        let [count, cmd, special, args] = commands.parseCommand(str.replace(/^'(.*)'$/, "$1"));
        let command = commands.get(cmd);

        if (command === null) {
            err = "E492: Not a " + config.name.toLowerCase() + " command: " + str;
            dactyl.focusContent();
        }
        else if (command.action === null)
            err = "E666: Internal error: command.action === null"; // TODO: need to perform this test? -- djk
        else if (count != null && !command.count)
            err = "E481: No range allowed";
        else if (special && !command.bang)
            err = "E477: No ! allowed";

        dactyl.assert(!err, err);
        if (!silent)
            commandline.command = str.replace(/^\s*:\s*/, "");

        command.execute(args, special, count, modifiers);
    },

    /**
     * Focuses the content window.
     *
     * @param {boolean} clearFocusedElement Remove focus from any focused
     *     element.
     */
    focusContent: function (clearFocusedElement) {
        if (window != services.get("windowWatcher").activeWindow)
            return;

        let elem = config.mainWidget || window.content;
        // TODO: make more generic
        try {
            if (this.has("mail") && !config.isComposeWindow) {
                let i = gDBView.selection.currentIndex;
                if (i == -1 && gDBView.rowCount >= 0)
                    i = 0;
                gDBView.selection.select(i);
            }
            else if (this.has("tabs")) {
                let frame = tabs.localStore.focusedFrame;
                if (frame && frame.top == window.content)
                    elem = frame;
            }
        }
        catch (e) {}

        if (clearFocusedElement && dactyl.focus)
            dactyl.focus.blur();
        if (elem && elem != dactyl.focus)
            elem.focus();
    },

    /**
     * Returns whether this Dactyl extension supports <b>feature</b>.
     *
     * @param {string} feature The feature name.
     * @returns {boolean}
     */
    has: function (feature) config.features.indexOf(feature) >= 0,

    /**
     * Returns the URL of the specified help <b>topic</b> if it exists.
     *
     * @param {string} topic The help topic to lookup.
     * @param {boolean} unchunked Whether to search the unchunked help page.
     * @returns {string}
     */
    findHelp: function (topic, unchunked) {
        if (topic in services.get("dactyl:").FILE_MAP)
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
        if ("noscriptOverlay" in window) {
            noscriptOverlay.safeAllow("chrome-data:", true, false);
            noscriptOverlay.safeAllow("dactyl:", true, false);
        }

        if(!this.helpInitialized) {
            let namespaces = [config.name.toLowerCase(), "dactyl"];
            services.get("dactyl:").init({});

            let tagMap = services.get("dactyl:").HELP_TAGS;
            let fileMap = services.get("dactyl:").FILE_MAP;
            let overlayMap = services.get("dactyl:").OVERLAY_MAP;

            // Left as an XPCOM instantiation so it can easilly be moved
            // into XPCOM code.
            function XSLTProcessor(sheet) {
                let xslt = Cc["@mozilla.org/document-transformer;1?type=xslt"].createInstance(Ci.nsIXSLTProcessor);
                xslt.importStylesheet(util.httpGet(sheet).responseXML);
                return xslt;
            }

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
                doc = XSLT.transformToDocument(doc);
                for (let elem in util.evaluateXPath("//xhtml:a/@id", doc))
                    tagMap[elem.value] = file;
            }

            const XSLT = XSLTProcessor("chrome://dactyl/content/help-single.xsl");

            // Scrape the list of help files from all.xml
            // Always process main and overlay files, since XSLTProcessor and
            // XMLHttpRequest don't allow access to chrome documents.
            tagMap.all = "all";
            let files = findHelpFile("all").map(function (doc)
                    [f.value for (f in util.evaluateXPath(
                        "//dactyl:include/@href", doc))]);

            // Scrape the tags from the rest of the help files.
            util.Array.flatten(files).forEach(function (file) {
                findHelpFile(file).forEach(function (doc) {
                    addTags(file, doc);
                });
            });

            // Process plugin help entries.
            XML.ignoreWhiteSpace = false;
            XML.prettyPrinting = false;
            XML.prettyIndent = 4;

            let body = XML();
            for (let [, context] in Iterator(plugins.contexts))
                if (context.INFO instanceof XML)
                    body += <h2 xmlns={NS.uri} tag={context.INFO.@name + '-plugin'}>{context.INFO.@summary}</h2> +
                        context.INFO;

            let help = '<?xml version="1.0"?>\n' +
                       '<?xml-stylesheet type="text/xsl" href="chrome://dactyl/content/help.xsl"?>\n' +
                       '<!DOCTYPE document SYSTEM "chrome://dactyl/content/dactyl.dtd">' +
                <document xmlns={NS}
                    name="plugins" title={config.name + " Plugins"}>
                    <h1 tag="using-plugins">Using Plugins</h1>
                    <toc start="2"/>

                    {body}
                </document>.toXMLString();
            fileMap["plugins"] = function () ['text/xml;charset=UTF-8', help];

            addTags("plugins", util.httpGet("dactyl://help/plugins").responseXML);
            this.helpInitialized = true;
        }
    },

    exportHelp: function (path) {
        const FILE = io.File(path);
        const PATH = FILE.leafName.replace(/\..*/, "") + "/";
        const TIME = Date.now();

        dactyl.initHelp();
        let zip = services.create("zipWriter");
        zip.open(FILE, File.MODE_CREATE | File.MODE_WRONLY | File.MODE_TRUNCATE);
        function addURIEntry(file, uri)
            zip.addEntryChannel(PATH + file, TIME, 9,
                services.get("io").newChannel(uri, null, null), false);
        function addDataEntry(file, data) // Inideal to an extreme.
            addURIEntry(file, "data:text/plain;charset=UTF-8," + encodeURI(data));

        let empty = util.Array.toObject(
            "area base basefont br col frame hr img input isindex link meta param"
            .split(" ").map(Array.concat));

        let chrome = {};
        for (let [file,] in Iterator(services.get("dactyl:").FILE_MAP)) {
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
                        if (node instanceof HTMLScriptElement)
                            return;

                        data.push("<"); data.push(node.localName);
                        if (node instanceof HTMLHtmlElement)
                            data.push(" xmlns=" + XHTML.uri.quote());

                        for (let { name: name, value: value } in util.Array.itervalues(node.attributes)) {
                            if (name == "dactyl:highlight") {
                                name = "class";
                                value = "hl-" + value;
                            }
                            if (name == "href") {
                                if (value.indexOf("dactyl://help-tag/") == 0)
                                    value = services.get("io").newChannel(value, null, null).originalURI.path.substr(1);
                                if (!/[#\/]/.test(value))
                                    value += ".xhtml";
                            }
                            if (name == "src" && value.indexOf(":") > 0) {
                                chrome[value] = value.replace(/.*\//, "");;
                                value = value.replace(/.*\//, "");
                            }
                            data.push(" ");
                            data.push(name);
                            data.push('="');
                            data.push(<>{value}</>.toXMLString());
                            data.push('"')
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
            fix(content.document.documentElement);
            addDataEntry(file + ".xhtml", data.join(""));
        }

        let data = [h.selector.replace(/^\[.*?=(.*?)\]/, ".hl-$1").replace(/html\|/, "") +
                        "\t{" + h.value + "}"
                    for (h in highlight) if (/^Help|^Logo/.test(h.class))];

        data = data.join("\n");
        addDataEntry("help.css", data.replace(/chrome:[^ ")]+\//g, ""));

        let re = /(chrome:[^ ");]+\/)([^ ");]+)/g;
        while ((m = re.exec(data)))
            chrome[m[0]] = m[2];

        for (let [uri, leaf] in Iterator(chrome))
            addURIEntry(leaf, uri);

        zip.close();
    },

    /**
     * Opens the help page containing the specified <b>topic</b> if it
     * exists.
     *
     * @param {string} topic The help topic to open.
     * @param {boolean} unchunked Whether to use the unchunked help page.
     * @returns {string}
     */
    help: function (topic, unchunked) {
        dactyl.initHelp();
        if (!topic) {
            let helpFile = unchunked ? "all" : options["helpfile"];

            if (helpFile in services.get("dactyl:").FILE_MAP)
                dactyl.open("dactyl://help/" + helpFile, { from: "help" });
            else
                dactyl.echomsg("Sorry, help file " + helpFile.quote() + " not found");
            return;
        }

        let page = this.findHelp(topic, unchunked);
        dactyl.assert(page != null, "E149: Sorry, no help for " + topic);

        dactyl.open("dactyl://help/" + page, { from: "help" });
        if (options.get("activate").has("all", "help"))
            content.postMessage("fragmentChange", "*");
    },

    /**
     * The map of global variables.
     *
     * These are set and accessed with the "g:" prefix.
     */
    globalVariables: {},

    loadPlugins: function () {
        function sourceDirectory(dir) {
            dactyl.assert(dir.isReadable(), "E484: Can't open file " + dir.path);

            dactyl.log("Sourcing plugin directory: " + dir.path + "...", 3);
            dir.readDirectory(true).forEach(function (file) {
                if (file.isFile() && /\.(js|vimp)$/i.test(file.path) && !(file.path in dactyl.pluginFiles)) {
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

        let dirs = io.getRuntimeDirectories("plugin");

        if (dirs.length == 0) {
            dactyl.log("No user plugin directory found", 3);
            return;
        }

        dactyl.echomsg('Searching for "plugin/**/*.{js,vimp}" in '
                            + [dir.path.replace(/.plugin$/, "") for ([, dir] in Iterator(dirs))]
                                .join(",").quote(), 2);

        dirs.forEach(function (dir) {
            dactyl.echomsg("Searching for " + (dir.path + "/**/*.{js,vimp}").quote(), 3);
            sourceDirectory(dir);
        });
    },

    // TODO: add proper level constants
    /**
     * Logs a message to the JavaScript error console. Each message has an
     * associated log level. Only messages with a log level less than or
     * equal to <b>level</b> will be printed. If <b>msg</b> is an object,
     * it is pretty printed.
     *
     * @param {string|Object} msg The message to print.
     * @param {number} level The logging level 0 - 15.
     */
    log: function (msg, level) {
        let verbose = 0;
        if (level == undefined)
            level = 1;

        // options does not exist at the very beginning
        if (modules.options)
            verbose = options.getPref("extensions.dactyl.loglevel", 0);

        if (level > verbose)
            return;

        if (typeof msg == "object")
            msg = util.objectToString(msg, false);

        services.get("console").logStringMessage(config.name.toLowerCase() + ": " + msg);
    },

    /**
     * Opens one or more URLs. Returns true when load was initiated, or
     * false on error.
     *
     * @param {string|string[]} urls Either a URL string or an array of URLs.
     *     The array can look like this:
     *       ["url1", "url2", "url3", ...]
     *     or:
     *       [["url1", postdata1], ["url2", postdata2], ...]
     * @param {number|Object} where If ommited, CURRENT_TAB is assumed but NEW_TAB
     *     is set when dactyl.forceNewTab is true.
     * @param {boolean} force Don't prompt whether to open more than 20
     *     tabs.
     * @returns {boolean}
     */
    open: function (urls, params, force) {
        if (typeof urls == "string")
            urls = dactyl.stringToURLArray(urls);

        if (urls.length > 20 && !force) {
            commandline.input("This will open " + urls.length + " new tabs. Would you like to continue? (yes/[no]) ",
                function (resp) {
                    if (resp && resp.match(/^y(es)?$/i))
                        dactyl.open(urls, params, true);
                });
            return;
        }

        let flags = 0;
        params = params || {};
        if (isarray(params))
            params = { where: params };

        for (let [opt, flag] in Iterator({ replace: "REPLACE_HISTORY", hide: "BYPASS_HISTORY" }))
            if (params[opt])
                flags |= Ci.nsIWebNavigation["LOAD_FLAGS_" + flag];

        let where = params.where || dactyl.CURRENT_TAB;
        let background = ("background" in params) ? params.background : params.where == dactyl.NEW_BACKGROUND_TAB;
        if ("from" in params && dactyl.has("tabs")) {
            if (!('where' in params) && options.get("newtab").has("all", params.from))
                where = dactyl.NEW_TAB;
            background = !options.get("activate").has("all", params.from);
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
                    if (!dactyl.has("tabs")) {
                        open(urls, dactyl.NEW_WINDOW);
                        return;
                    }

                    options.withContext(function () {
                        options.setPref("browser.tabs.loadInBackground", true);
                        browser.loadOneTab(url, null, null, postdata, background);
                    });
                    break;

                case dactyl.NEW_WINDOW:
                    window.open();
                    let win = services.get("windowMediator").getMostRecentWindow("navigator:browser");
                    win.loadURI(url, null, postdata);
                    browser = win.getBrowser();
                    break;
                }
            }
            catch(e) {}
        }

        if (dactyl.forceNewTab)
            where = dactyl.NEW_TAB;
        else if (dactyl.forceNewWindow)
            where = dactyl.NEW_WINDOW;
        else if (!where)
            where = dactyl.CURRENT_TAB;

        for (let [, url] in Iterator(urls)) {
            open(url, where);
            background = true;
        }
    },

    pluginFiles: {},

    // namespace for plugins/scripts. Actually (only) the active plugin must/can set a
    // v.plugins.mode = <str> string to show on v.modes.CUSTOM
    // v.plugins.stop = <func> hooked on a v.modes.reset()
    // v.plugins.onEvent = <func> function triggered, on keypresses (unless <esc>) (see events.js)
    plugins: plugins,

    /**
     * Quit the host application, no matter how many tabs/windows are open.
     *
     * @param {boolean} saveSession If true the current session will be
     *     saved and restored when the host application is restarted.
     * @param {boolean} force Forcibly quit irrespective of whether all
     *    windows could be closed individually.
     */
    quit: function (saveSession, force) {
        // TODO: Use safeSetPref?
        if (saveSession)
            options.setPref("browser.startup.page", 3); // start with saved session
        else
            options.setPref("browser.startup.page", 1); // start with default homepage session

        if (force)
            services.get("appStartup").quit(Ci.nsIAppStartup.eForceQuit);
        else
            window.goQuitApplication();
    },

    /**
     * Returns an array of URLs parsed from <b>str</b>.
     *
     * Given a string like 'google bla, www.osnews.com' return an array
     * ['www.google.com/search?q=bla', 'www.osnews.com']
     *
     * @param {string} str
     * @returns {string[]}
     */
    stringToURLArray: function stringToURLArray(str) {
        let urls;

        if (options["urlseparator"])
            urls = util.splitLiteral(str, RegExp("\\s*" + options["urlseparator"] + "\\s*"));
        else
            urls = [str];

        return urls.map(function (url) {
            if (/^(\.{0,2}|~)\//.test(url)) {
                try {
                    // Try to find a matching file.
                    let file = io.File(url);
                    if (file.exists() && file.isReadable())
                        return services.get("io").newFileURI(file).spec;
                }
                catch (e) {}
            }

            // strip each 'URL' - makes things simpler later on
            url = url.replace(/^\s+|\s+$/, "");

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

    /*
     * Tests a condition and throws a FailedAssertion error on
     * failure.
     *
     * @param {boolean} condition The condition to test.
     * @param {string}  message The message to present to the
     *                          user on failure.
     */
    assert: function (condition, message) {
        if (!condition)
            throw new FailedAssertion(message);
    },

    /**
     * Traps errors in the called function, possibly reporting them.
     *
     * @param {function} func The function to call
     * @param {object} self The 'this' object for the function.
     */
    trapErrors: function (func, self) {
        try {
            return func.apply(self || this, Array.slice(arguments, 2));
        }
        catch (e) {
            dactyl.reportError(e, true);
            return undefined;
        }
    },

    /**
     * Reports an error to both the console and the host application's
     * Error Console.
     *
     * @param {Object} error The error object.
     */
    reportError: function (error, echo) {
        if (error instanceof FailedAssertion) {
            if (error.message)
                dactyl.echoerr(error.message);
            else
                dactyl.beep();
            return;
        }
        if (echo)
            dactyl.echoerr(error);

        if (Cu.reportError)
            Cu.reportError(error);

        try {
            let obj = {
                toString: function () String(error),
                stack: <>{String.replace(error.stack || Error().stack, /^/mg, "\t")}</>
            };
            for (let [k, v] in Iterator(error)) {
                if (!(k in obj))
                    obj[k] = v;
            }
            if (dactyl.storeErrors) {
                let errors = storage.newArray("errors", { store: false });
                errors.toString = function () [String(v[0]) + "\n" + v[1] for ([k, v] in this)].join("\n\n");
                errors.push([new Date, obj + obj.stack]);
            }
            dactyl.dump(String(error));
            dactyl.dump(obj);
            dactyl.dump("");
        }
        catch (e) { window.dump(e); }
    },

    /**
     * Restart the host application.
     */
    restart: function () {
        // notify all windows that an application quit has been requested.
        var cancelQuit = Cc["@mozilla.org/supports-PRBool;1"].createInstance(Ci.nsISupportsPRBool);
        services.get("observer").notifyObservers(cancelQuit, "quit-application-requested", null);

        // something aborted the quit process.
        if (cancelQuit.data)
            return;

        // notify all windows that an application quit has been granted.
        services.get("observer").notifyObservers(null, "quit-application-granted", null);

        // enumerate all windows and call shutdown handlers
        let windows = services.get("windowMediator").getEnumerator(null);
        while (windows.hasMoreElements()) {
            let win = windows.getNext();
            if (("tryToClose" in win) && !win.tryToClose())
                return;
        }
        services.get("appStartup").quit(Ci.nsIAppStartup.eRestart | Ci.nsIAppStartup.eAttemptQuit);
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
            [["+u"], commands.OPTIONS_STRING],
            [["++noplugin"], commands.OPTIONS_NOARG],
            [["++cmd"], commands.OPTIONS_STRING, null, null, true],
            [["+c"], commands.OPTIONS_STRING, null, null, true]
        ];
        return commands.parseArgs(cmdline, options, "*");
    },

    variableReference: function (string) {
        if (!string)
            return [null, null, null];

        let matches = string.match(/^([bwtglsv]):(\w+)/);
        if (matches) { // Variable
            // Other variables should be implemented
            if (matches[1] == "g") {
                if (matches[2] in this.globalVariables)
                    return [this.globalVariables, matches[2], matches[1]];
                else
                    return [null, matches[2], matches[1]];
            }
        }
        else { // Global variable
            if (string in this.globalVariables)
                return [this.globalVariables, string, "g"];
            else
                return [null, string, "g"];
        }
        throw Error("What the fuck?");
    },

    /**
     * @property {Window[]} Returns an array of all the host application's
     *     open windows.
     */
    get windows() {
        let windows = [];
        let enumerator = services.get("windowMediator").getEnumerator("navigator:browser");
        while (enumerator.hasMoreElements())
            windows.push(enumerator.getNext());

        return windows;
    }

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

    // return the platform normalized to Vim values
    getPlatformFeature: function () {
        let platform = services.get("runtime").OS;
        return /^Mac/.test(platform) ? "MacUnix" : platform == "Win32" ? "Win32" : "Unix";
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
    config: function () {
        config.features.push(Dactyl.getPlatformFeature());
    },

    // Only general options are added here, which are valid for all Dactyl extensions
    options: function () {
        options.add(["errorbells", "eb"],
            "Ring the bell when an error message is displayed",
            "boolean", false);

        options.add(["exrc", "ex"],
            "Allow reading of an RC file in the current directory",
            "boolean", false);

        const groups = {
            config: {
                opts: config.guioptions,
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
            scroll: {
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

                    if (class_.length)
                        styles.addSheet(true, "scrollbar", "*", class_.join(", ") + " { visibility: collapse !important; }", true);
                    else
                        styles.removeSheet(true, "scrollbar");
                    options.safeSetPref("layout.scrollbar.side", opts.indexOf("l") >= 0 ? 3 : 2,
                                        "See 'guioptions' scrollbar flags.");
                },
                validator: function (opts) (opts.indexOf("l") < 0 || opts.indexOf("r") < 0)
            },
            tab: {
                opts: {
                    n: ["Tab number", highlight.selector("TabNumber")],
                    N: ["Tab number over icon", highlight.selector("TabIconNumber")]
                },
                setter: function (opts) {
                    const self = this;
                    let classes = [v[1] for ([k, v] in Iterator(this.opts)) if (opts.indexOf(k) < 0)];
                    let css = classes.length ? classes.join(",") + "{ display: none; }" : "";
                    styles.addSheet(true, "taboptions", "chrome://*", css);
                    tabs.tabsBound = Array.some(opts, function (k) k in self.opts);
                    statusline.updateTabCount();
                }
            }
        };

        options.add(["fullscreen", "fs"],
            "Show the current window fullscreen",
            "boolean", false, {
                setter: function (value) window.fullScreen = value,
                getter: function () window.fullScreen
            });

        options.add(["guioptions", "go"],
            "Show or hide certain GUI elements like the menu or toolbar",
            "charlist", config.defaults.guioptions || "", {
                setter: function (value) {
                    for (let [, group] in Iterator(groups))
                        group.setter(value);
                    return value;
                },
                completer: function (context) {
                    let opts = [v.opts for ([k, v] in Iterator(groups))];
                    opts = opts.map(function (opt) [[k, v[0]] for ([k, v] in Iterator(opt))]);
                    return util.Array.flatten(opts);
                },
                validator: function (val) Option.validateCompleter.call(this, val) &&
                        [v for ([k, v] in Iterator(groups))].every(function (g) !g.validator || g.validator(val))
            });

        options.add(["helpfile", "hf"],
            "Name of the main help file",
            "string", "intro");

        options.add(["loadplugins", "lpl"],
            "Load plugin scripts when starting up",
            "boolean", true);

        options.add(["titlestring"],
            "Change the title of the window",
            "string", config.defaults.titlestring || config.hostApplication,
            {
                setter: function (value) {
                    let win = document.documentElement;
                    function updateTitle(old, current) {
                        document.title = document.title.replace(RegExp("(.*)" + util.escapeRegex(old)), "$1" + current);
                    }

                    // TODO: remove this FF3.5 test when we no longer support 3.0
                    //     : make this a config feature
                    if (services.get("privateBrowsing")) {
                        let oldValue = win.getAttribute("titlemodifier_normal");
                        let suffix = win.getAttribute("titlemodifier_privatebrowsing").substr(oldValue.length);

                        win.setAttribute("titlemodifier_normal", value);
                        win.setAttribute("titlemodifier_privatebrowsing", value + suffix);

                        if (services.get("privateBrowsing").privateBrowsingEnabled) {
                            updateTitle(oldValue + suffix, value + suffix);
                            return value;
                        }
                    }

                    updateTitle(win.getAttribute("titlemodifier"), value);
                    win.setAttribute("titlemodifier", value);

                    return value;
                }
            });

        options.add(["verbose", "vbs"],
            "Define which info messages are displayed",
            "number", 1,
            { validator: function (value) value >= 0 && value <= 15 });

        options.add(["visualbell", "vb"],
            "Use visual bell instead of beeping on errors",
            "boolean", false,
            {
                setter: function (value) {
                    options.safeSetPref("accessibility.typeaheadfind.enablesound", !value,
                                        "See 'visualbell' option");
                    return value;
                }
            });
    },

    mappings: function () {
        mappings.add(modes.all, ["<F1>"],
            "Open the help page",
            function () { dactyl.help(); });

        if (dactyl.has("session")) {
            mappings.add([modes.NORMAL], ["ZQ"],
                "Quit and don't save the session",
                function () { dactyl.quit(false); });
        }

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

        commands.add(["beep"],
            "Play a system beep", // Play? Wrong word. Implies some kind of musicality. --Kris
            function () { dactyl.beep(); },
            { argCount: "0" });

        commands.add(["dia[log]"],
            "Open a " + config.name + " dialog",
            function (args) {
                let arg = args[0];

                try {
                    dactyl.assert(args[0] in config.dialogs, "E475: Invalid argument: " + arg);
                    config.dialogs[args[0]][1]();
                }
                catch (e) {
                    dactyl.echoerr("Error opening " + arg.quote() + ": " + e);
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
                let arg = args.literalArg;
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
                    let cmd = dactyl.usereval(args.string);
                    dactyl.execute(cmd, null, true);
                }
                catch (e) {
                    dactyl.echoerr(e);
                }
            });

        ///////////////////////////////////////////////////////////////////////////

        if (typeof AddonManager == "undefined") {
            modules.AddonManager = {
                getInstallForFile: function (file, callback, mimetype) {
                    callback({
                        install: function () {
                            services.get("extensionManager").installItemFromFile(file, "app-profile");
                        }
                    });
                },
                getAddonById: function (id, callback) {
                    let addon = id;
                    if (!isobject(addon))
                        addon = services.get("extensionManager").getItemForID(id);
                    if (!addon)
                        return callback(null);

                    function getRdfProperty(item, property) {
                        let resource = services.get("rdf").GetResource("urn:mozilla:item:" + item.id);
                        let value = "";

                        if (resource) {
                            let target = services.get("extensionManager").datasource.GetTarget(resource,
                                services.get("rdf").GetResource("http://www.mozilla.org/2004/em-rdf#" + property), true);
                            if (target && target instanceof Ci.nsIRDFLiteral)
                                value = target.Value;
                        }

                        return value;
                    }

                    ["aboutURL", "creator", "description", "developers",
                     "homepageURL", "iconURL", "installDate", "name",
                     "optionsURL", "releaseNotesURI", "updateDate"].forEach(function (item) {
                        addon[item] = getRdfProperty(addon, item);
                    });
                    addon.isActive = getRdfProperty(addon, "isDisabled") != "true";

                    addon.uninstall = function () {
                        services.get("extensionManager").uninstallItem(this.id);
                    };
                    addon.appDisabled = false;
                    addon.__defineGetter("userDisabled", function() getRdfProperty("userDisabled") == "true");
                    addon.__defineSetter__("userDisabled", function(val) {
                        services.get("extensionManager")[val ? "enableItem" : "disableItem"](this.id);
                    });

                    return callback(addon);
                },
                getAddonsByTypes: function (types, callback) {
                    let res = [];
                    for (let [,type] in Iterator(types))
                        for (let [,item] in Iterator(services.get("extensionManager")
                                    .getItemList(Ci.nsIUpdateItem["TYPE_" + type.toUpperCase()], {})))
                            res.append(this.getAddonById(item));
                    return res;
                }
            };

        }

        ///////////////////////////////////////////////////////////////////////////
        
        function callResult(method) {
            let args = Array.slice(arguments, 1);
            return function (result) { result[method].apply(result, args) };
        }

        commands.add(["exta[dd]"],
            "Install an extension",
            function (args) {
                let url  = args[0];
                let file = io.File(url);

                if (!file.exists())
                    AddonManager.getInstallForURL(url,   callResult("install"), "application/x-xpinstall");
                else if (file.isReadable() && file.isFile())
                    AddonManager.getInstallForFile(file, callResult("install"), "application/x-xpinstall");
                else if (file.isDirectory())
                    dactyl.echomsg("Cannot install a directory: " + file.path.quote(), 0);
                else
                    dactyl.echoerr("E484: Can't open file " + file.path);
            }, {
                argCount: "1",
                completer: function (context) {
                    context.filters.push(function ({ item: f }) f.isDirectory() || /\.xpi$/.test(f.leafName));
                    completion.file(context);
                }
            });

        // TODO: handle extension dependencies
        [
            {
                name: "extde[lete]",
                description: "Uninstall an extension",
                action: callResult("uninstall")
            },
            {
                name: "exte[nable]",
                description: "Enable an extension",
                action: function (addon) addon.userDisabled = false,
                filter: function ({ item: e }) e.userDisabled
            },
            {
                name: "extd[isable]",
                description: "Disable an extension",
                action: function (addon) addon.userDisabled = true,
                filter: function ({ item: e }) !e.userDisabled
            }
        ].forEach(function (command) {
            commands.add([command.name],
                command.description,
                function (args) {
                    let name = args[0];
                    if (args.bang)
                        dactyl.assert(!name, "E488: Trailing characters");
                    else
                        dactyl.assert(name, "E471: Argument required");

                    AddonManager.getAddonsByTypes(["extension"], function (list) {
                        if (!args.bang)
                            list = list.filter(function (extension) extension.name == name);
                        list.forEach(command.action);
                    });
                }, {
                    argCount: "?", // FIXME: should be "1"
                    bang: true,
                    completer: function (context) {
                        completion.extension(context);
                        if (command.filter)
                            context.filters.push(command.filter);
                    },
                    literal: 0
                });
        });

        commands.add(["exto[ptions]", "extp[references]"],
            "Open an extension's preference dialog",
            function (args) {
                AddonManager.getAddonsByTypes(["extension"], function (list) {
                    list = list.filter(function (extension) extension.name == args[0]);
                    if (!list.length || !list[0].optionsURL)
                        dactyl.echoerr("E474: Invalid argument");
                    else if (args.bang)
                        window.openDialog(list[0].optionsURL, "_blank", "chrome");
                    else
                        dactyl.open(list[0].optionsURL, { from: "extoptions" });
                });
            }, {
                argCount: "1",
                bang: true,
                completer: function (context) {
                    completion.extension(context);
                    context.filters.push(function ({ item: e }) e.isActive && e.optionsURL);
                },
                literal: 0
            });

        commands.add(["extens[ions]", "exts"],
            "List available extensions",
            function (args) {
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
                                  ((e.userDisabled || e.appDisabled) == !e.isActive ? XML() :
                                      <>&#xa0;({e.userDisabled || e.appDisabled
                                            ? <span highlight="Disabled">disabled</span>
                                            : <span highlight="Enabled">enabled</span>}
                                            on restart)
                                      </>),
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
                if (args.bang) { // open JavaScript console
                    dactyl.open("chrome://global/content/console.xul",
                        { from: "javascript" });
                }
                else {
                    try {
                        dactyl.usereval(args.string);
                    }
                    catch (e) {
                        dactyl.echoerr(e);
                    }
                }
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
            function (args) { events.feedkeys(args.string, args.bang); },
            {
                argCount: "+",
                bang: true
            });

        commands.add(["optionu[sage]"],
            "List all options with a short description",
            function (args) { Dactyl.showHelpIndex("option-index", options, args.bang); }, {
                argCount: "0",
                bang: true
            });

        commands.add(["q[uit]"],
            dactyl.has("tabs") ? "Quit current tab" : "Quit application",
            function (args) {
                if (dactyl.has("tabs"))
                    tabs.remove(config.browser.mCurrentTab, 1, false, 1);
                else
                    dactyl.quit(false, args.bang);
            }, {
                argCount: "0",
                bang: true
            });

        commands.add(["res[tart]"],
            "Force " + config.name + " to restart",
            function () { dactyl.restart(); },
            { argCount: "0" });

        var toolbox = document.getElementById("navigator-toolbox");
        if (toolbox) {
            function findToolbar(name) util.evaluateXPath(
                "./*[@toolbarname=" + util.escapeString(name, "'") + "]",
                document, toolbox).snapshotItem(0);

            let tbcmd = function (names, desc, action, filter) {
                commands.add(names, desc,
                    function (args) {
                        let toolbar = findToolbar(args[0]);
                        dactyl.assert(toolbar, "E474: Invalid argument");
                        action(toolbar);
                    }, {
                        argcount: "1",
                        completer: function (context) {
                            completion.toolbar(context)
                            if (filter)
                                context.filters.push(filter);
                        },
                        literal: 0
                    });
            };

            tbcmd(["toolbars[how]", "tbs[how]"], "Show the named toolbar",
                function (toolbar) toolbar.collapsed = false,
                function (item) item.item.collapsed);
            tbcmd(["toolbarh[ide]", "tbh[ide]"], "Hide the named toolbar",
                function (toolbar) toolbar.collapsed = true,
                function (item) !item.item.collapsed);
            tbcmd(["toolbart[oggle]", "tbt[oggle]"], "Toggle the named toolbar",
                function (toolbar) toolbar.collapsed = !toolbar.collapsed);
        }

        commands.add(["time"],
            "Profile a piece of code or run a command multiple times",
            function (args) {
                let count = args.count;
                let special = args.bang;
                args = args.string;

                if (args[0] == ":")
                    var method = function () dactyl.execute(args, null, true);
                else
                    method = dactyl.userfunction(args);

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
                    dactyl.execute(args[0], null, true);
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
                        {config.name} {dactyl.version} running on:<br/>{navigator.userAgent}
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
            context.completions = [[k, v[0]] for ([k, v] in Iterator(config.dialogs))];
        };

        completion.extension = function extension(context) {
            context.title = ["Extension"];
            context.anchored = false;
            context.keys = { text: "name", description: "description", icon: "iconURL" },
            context.incomplete = true;
            AddonManager.getAddonsByTypes(["extension"], function (addons) {
                context.incomplete = false;
                context.completions = addons;
            });
        };

        completion.help = function help(context, unchunked) {
            dactyl.initHelp();
            context.title = ["Help"];
            context.anchored = false;
            context.completions = services.get("dactyl:").HELP_TAGS;
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
            context.title = ["Window", "Title"]
            context.keys = { text: function (win) dactyl.windows.indexOf(win) + 1, description: function (win) win.document.title };
            context.completions = dactyl.windows;
        };
    },
    load: function () {
        dactyl.triggerObserver("load");

        dactyl.log("All modules loaded", 3);

        services.add("commandLineHandler", "@mozilla.org/commandlinehandler/general-startup;1?type=" + config.name.toLowerCase());

        let commandline = services.get("commandLineHandler").optionValue;
        if (commandline) {
            let args = dactyl.parseCommandLine(commandline);
            dactyl.commandLineOptions.rcFile = args["+u"];
            dactyl.commandLineOptions.noPlugins = "++noplugin" in args;
            dactyl.commandLineOptions.postCommands = args["+c"];
            dactyl.commandLineOptions.preCommands = args["++cmd"];
            dactyl.dump("Processing command-line option: " + commandline);
        }

        dactyl.log("Command-line options: " + util.objectToString(dactyl.commandLineOptions), 3);

        // first time intro message
        const firstTime = "extensions." + config.name.toLowerCase() + ".firsttime";
        if (options.getPref(firstTime, true)) {
            util.timeout(function () {
                dactyl.help();
                options.setPref(firstTime, false);
            }, 1000);
        }

        // always start in normal mode
        modes.reset();

        // TODO: we should have some class where all this guioptions stuff fits well
        Dactyl.hideGUI();

        if (dactyl.commandLineOptions.preCommands)
            dactyl.commandLineOptions.preCommands.forEach(function (cmd) {
                dactyl.execute(cmd);
            });

        // finally, read the RC file and source plugins
        // make sourcing asynchronous, otherwise commands that open new tabs won't work
        util.timeout(function () {
            let extensionName = config.name.toUpperCase();
            let init = services.get("environment").get(extensionName + "_INIT");
            let rcFile = io.getRCFile("~");

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
                        io.source(rcFile.path, true);
                        services.get("environment").set("MY_" + extensionName + "RC", rcFile.path);
                    }
                    else
                        dactyl.log("No user RC file found", 3);
                }

                if (options["exrc"] && !dactyl.commandLineOptions.rcFile) {
                    let localRCFile = io.getRCFile(io.getCurrentDirectory().path);
                    if (localRCFile && !localRCFile.equals(rcFile))
                        io.source(localRCFile.path, true);
                }
            }

            if (dactyl.commandLineOptions.rcFile == "NONE" || dactyl.commandLineOptions.noPlugins)
                options["loadplugins"] = false;

            if (options["loadplugins"])
                dactyl.loadPlugins();

            // after sourcing the initialization files, this function will set
            // all gui options to their default values, if they have not been
            // set before by any RC file
            for (let option in options) {
                // 'encoding' option should not be set at this timing.
                // Probably a wrong value is set into the option,
                // if current page's encoging is not UTF-8.
                if (option.name != "encoding" && option.setter)
                    option.value = option.value;
            }

            if (dactyl.commandLineOptions.postCommands)
                dactyl.commandLineOptions.postCommands.forEach(function (cmd) {
                    dactyl.execute(cmd);
                });

            dactyl.triggerObserver("enter", null);
            autocommands.trigger("Enter", {});
        }, 0);

        statusline.update();
        dactyl.log(config.name + " fully initialized", 0);
        dactyl.initialized = true;
    }
});

// vim: set fdm=marker sw=4 ts=4 et:
