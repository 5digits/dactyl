// Copyright (c) 2008-2014 Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

defineModule("help", {
    exports: ["help"],
    require: ["cache", "dom", "protocol", "services", "util"]
});

lazyRequire("completion", ["completion"]);
lazyRequire("overlay", ["overlay"]);
lazyRequire("template", ["template"]);

var HelpBuilder = Class("HelpBuilder", {
    init: function init() {
        try {
            // The versions munger will need to access the tag map
            // during this process and without this we'll get an
            // infinite loop.
            help._data = this;

            this.files = {};
            this.tags = {};
            this.overlays = {};

            // Scrape the list of help files from all.xml
            this.tags["all"] = this.tags["all.xml"] = "all";
            let files = this.findHelpFile("all").map(doc =>
                    [f.value for (f in DOM.XPath("//dactyl:include/@href", doc))]);

            // Scrape the tags from the rest of the help files.
            array.flatten(files).forEach(function (file) {
                this.tags[file + ".xml"] = file;
                this.findHelpFile(file).forEach(function (doc) {
                    this.addTags(file, doc);
                }, this);
            }, this);
        }
        finally {
            delete help._data;
        }
    },

    toJSON: function toJSON() ({
        files: this.files,
        overlays: this.overlays,
        tags: this.tags
    }),

    // Find the tags in the document.
    addTags: function addTags(file, doc) {
        for (let elem in DOM.XPath("//@tag|//dactyl:tags/text()|//dactyl:tag/text()", doc))
                for (let tag in values((elem.value || elem.textContent).split(/\s+/)))
            this.tags[tag] = file;
    },

    bases: ["dactyl://locale-local/", "dactyl://locale/", "dactyl://cache/help/"],

    // Find help and overlay files with the given name.
    findHelpFile: function findHelpFile(file) {
        let result = [];
        for (let base in values(this.bases)) {
            let url = [base, file, ".xml"].join("");
            let res = util.httpGet(url, { quiet: true });
            if (res) {
                if (res.responseXML.documentElement.localName == "document")
                    this.files[file] = url;
                if (res.responseXML.documentElement.localName == "overlay")
                    this.overlays[file] = url;
                result.push(res.responseXML);
            }
        }
        return result;
    }
});

var Help = Module("Help", {
    init: function init() {
        this.initialized = false;

        function Loop(fn)
            function (uri, path) {
                if (!help.initialized)
                    return RedirectChannel(uri.spec, uri, 2,
                                           "Initializing. Please wait...");

                return fn.apply(this, arguments);
            }

        update(services["dactyl:"].providers, {
            "help": Loop((uri, path) => help.files[path]),
            "help-overlay": Loop((uri, path) => help.overlays[path]),
            "help-tag": Loop(function (uri, path) {
                let tag = decodeURIComponent(path);
                if (tag in help.files)
                    return RedirectChannel("dactyl://help/" + tag, uri);
                if (tag in help.tags)
                    return RedirectChannel("dactyl://help/" + help.tags[tag] + "#" + tag.replace(/#/g, encodeURIComponent), uri);
            })
        });

        cache.register("help.json", HelpBuilder);

        cache.register("help/versions.xml", function () {
            let NEWS = util.httpGet(config.addon.getResourceURI("NEWS").spec,
                                    { mimeType: "text/plain;charset=UTF-8" })
                           .responseText;

            let re = util.regexp(UTF8(literal(function () /*
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
            */$)), "gmxy");

            let betas = util.regexp(/\[((?:b|rc)\d)\]/, "gx");

            let beta = array(betas.iterate(NEWS))
                        .map(m => m[1]).uniq().slice(-1)[0];

            function rec(text, level, li) {
                let res = [];
                let list, space, i = 0;

                for (let match in re.iterate(text)) {
                    if (match.comment)
                        continue;
                    else if (match.char) {
                        if (!list)
                            res.push(list = ["ul", {}]);
                        let li = ["li", {}];
                        li.push(rec(match.content
                                         .replace(RegExp("^" + match.space, "gm"), ""),
                                    level + 1,
                                    li));
                        list.push(li);
                    }
                    else if (match.par) {
                        let [, par, tags] = /([^]*?)\s*((?:\[[^\]]+\])*)\n*$/.exec(match.par);
                        let t = tags;
                        tags = array(betas.iterate(tags)).map(m => m[1]);

                        let group = !tags.length               ? "" :
                                    !tags.some(t => t == beta) ? "HelpNewsOld" : "HelpNewsNew";
                        if (i === 0 && li) {
                            li[1]["dactyl:highlight"] = group;
                            group = "";
                        }

                        list = null;
                        if (level == 0 && /^.*:\n$/.test(match.par)) {
                            let text = par.slice(0, -1);
                            res.push(["h2", { tag: "news-" + text },
                                          template.linkifyHelp(text, true)]);
                        }
                        else {
                            let [, a, b] = /^(IMPORTANT:?)?([^]*)/.exec(par);

                            res.push(["p", { "dactyl:highlight": group + " HelpNews" },
                                !tags.length ? "" : ["hl", { key: "HelpNewsTag" }, tags.join(" ")],
                                a ? ["hl", { key: "HelpWarning" }, a] : "",
                                template.linkifyHelp(b, true)]);
                        }
                    }
                    i++;
                }

                return res;
            }

            let body = rec(NEWS, 0);

            // E4X-FIXME
            // for each (let li in body..li) {
            //     let list = li..li.(@NS::highlight == "HelpNewsOld");
            //     if (list.length() && list.length() == li..li.(@NS::highlight != "").length()) {
            //         for each (let li in list)
            //             li.@NS::highlight = "";
            //         li.@NS::highlight = "HelpNewsOld";
            //     }
            // }

            return '<?xml version="1.0"?>\n' +
                   '<?xml-stylesheet type="text/xsl" href="dactyl://content/help.xsl"?>\n' +
                   DOM.toXML(["document", { xmlns: "dactyl", name: "versions",
                                  title: config.appName + " Versions" },
                       ["h1", { tag: "versions news NEWS" }, config.appName + " Versions"],
                       ["toc", { start: "2" }],

                       body]);
        }, true);
    },

    initialize: function initialize() {
        help.initialized = true;
    },

    flush: function flush(entries, time) {
        cache.flushEntry("help.json", time);

        for (let entry in values(Array.concat(entries || [])))
            cache.flushEntry(entry, time);
    },

    get data() this._data || cache.get("help.json"),

    get files() this.data.files,
    get overlays() this.data.overlays,
    get tags() this.data.tags,

    Local: function Local(dactyl, modules, window) ({
        init: function init() {
            dactyl.commands["dactyl.help"] = function (event) {
                let elem = event.originalTarget;
                modules.help.help(elem.getAttribute("tag") || elem.textContent);
            };
        },

        /**
         * Returns the URL of the specified help *topic* if it exists.
         *
         * @param {string} topic The help topic to look up.
         * @param {boolean} consolidated Whether to search the consolidated help page.
         * @returns {string}
         */
        findHelp: function (topic, consolidated) {
            if (!consolidated && hasOwnProperty(help.files, topic))
                return topic;
            let items = modules.completion._runCompleter("help", topic, null, !!consolidated).items;
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
         * Opens the help page containing the specified *topic* if it exists.
         *
         * @param {string} topic The help topic to open.
         * @param {boolean} consolidated Whether to use the consolidated help page.
         */
        help: function (topic, consolidated) {
            dactyl.initHelp();

            if (!topic) {
                let helpFile = consolidated ? "all" : modules.options["helpfile"];

                if (hasOwnProperty(help.files, helpFile))
                    dactyl.open("dactyl://help/" + helpFile, { from: "help" });
                else
                    dactyl.echomsg(_("help.noFile", helpFile.quote()));
                return;
            }

            let page = this.findHelp(topic, consolidated);
            dactyl.assert(page != null, _("help.noTopic", topic));

            dactyl.open("dactyl://help/" + page, { from: "help" });
        },

        exportHelp: function (path) {
            const FILE = io.File(path);
            const PATH = FILE.leafName.replace(/\..*/, "") + "/";
            const TIME = Date.now();

            if (!FILE.exists() && (/\/$/.test(path) && !/\./.test(FILE.leafName)))
                FILE.create(FILE.DIRECTORY_TYPE, 0o755);

            dactyl.initHelp();
            if (FILE.isDirectory()) {
                var addDataEntry = function addDataEntry(file, data) FILE.child(file).write(data);
                var addURIEntry  = function addURIEntry(file, uri) addDataEntry(file, util.httpGet(uri).responseText);
            }
            else {
                var zip = services.ZipWriter(FILE.file, File.MODE_CREATE | File.MODE_WRONLY | File.MODE_TRUNCATE);

                addURIEntry = function addURIEntry(file, uri)
                    zip.addEntryChannel(PATH + file, TIME, 9,
                        services.io.newChannel(uri, null, null), false);
                addDataEntry = function addDataEntry(file, data) // Unideal to an extreme.
                    addURIEntry(file, "data:text/plain;charset=UTF-8," + encodeURI(data));
            }

            let empty = RealSet("area base basefont br col frame hr img input isindex link meta param"
                                .split(" "));
            function fix(node) {
                switch (node.nodeType) {
                case Ci.nsIDOMNode.ELEMENT_NODE:
                    if (isinstance(node, [Ci.nsIDOMHTMLBaseElement]))
                        return;

                    data.push("<", node.localName);
                    if (node instanceof Ci.nsIDOMHTMLHtmlElement)
                        data.push(" xmlns=" + XHTML.quote(),
                                  " xmlns:dactyl=" + NS.quote());

                    for (let { name, value } in array.iterValues(node.attributes)) {
                        if (name == "dactyl:highlight") {
                            styles.add(value);
                            name = "class";
                            value = "hl-" + value;
                        }
                        if (name == "href") {
                            value = node.href || value;
                            if (value.startsWith("dactyl://help-tag/")) {
                                try {
                                    let uri = services.io.newChannel(value, null, null).originalURI;
                                    value = uri.spec == value ? "javascript:;" : uri.path.substr(1);
                                }
                                catch (e) {
                                    util.dump("Magical tag thingy failure for: " + value);
                                    dactyl.reportError(e);
                                }
                            }
                            if (!/^#|[\/](#|$)|^[a-z]+:/.test(value))
                                value = value.replace(/(#|$)/, ".xhtml$1");
                        }
                        if (name == "src" && value.indexOf(":") > 0) {
                            chromeFiles[value] = value.replace(/.*\//, "");
                            value = value.replace(/.*\//, "");
                        }

                        data.push(" ", name, '="', DOM.escapeHTML(value), '"');
                    }
                    if (empty.has(node.localName))
                        data.push(" />");
                    else {
                        data.push(">");
                        if (node instanceof Ci.nsIDOMHTMLHeadElement)
                            data.push('<link rel="stylesheet" type="text/css" href="help.css"/>');
                        Array.map(node.childNodes, fix);
                        data.push("</", node.localName, ">");
                    }
                    break;
                case Ci.nsIDOMNode.TEXT_NODE:
                    data.push(DOM.escapeHTML(node.textContent, true));
                }
            }

            let { buffer, content, events } = modules;
            let chromeFiles = {};
            let styles = RealSet();

            for (let [file, ] in Iterator(help.files)) {
                let url = "dactyl://help/" + file;
                dactyl.open(url);
                util.waitFor(() => (content.location.href == url && buffer.loaded &&
                                    content.document.documentElement instanceof Ci.nsIDOMHTMLHtmlElement),
                             15000);
                events.waitForPageLoad();
                var data = [
                    '<?xml version="1.0" encoding="UTF-8"?>\n',
                    '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN"\n',
                    '          "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">\n'
                ];
                fix(content.document.documentElement);
                addDataEntry(file + ".xhtml", data.join(""));
            }

            data = [h for (h in highlight) if (styles.has(h.class) || /^Help/.test(h.class))]
                .map(h => h.selector
                           .replace(/^\[.*?=(.*?)\]/, ".hl-$1")
                           .replace(/html\|/g, "") + "\t" + "{" + h.cssText + "}")
                .join("\n");
            addDataEntry("help.css", data.replace(/chrome:[^ ")]+\//g, ""));

            addDataEntry("tag-map.json", JSON.stringify(help.tags));

            let m, re = /(chrome:[^ ");]+\/)([^ ");]+)/g;
            while ((m = re.exec(data)))
                chromeFiles[m[0]] = m[2];

            for (let [uri, leaf] in Iterator(chromeFiles))
                addURIEntry(leaf, uri);

            if (zip)
                zip.close();
        }

    })
}, {
}, {
    commands: function initCommands(dactyl, modules, window) {
        const { commands, completion, help } = modules;

        [
            {
                name: ["h[elp]", "halp"],
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
                    dactyl.assert(!args.bang, _("help.dontPanic"));
                    help.help(args.literalArg, consolidated);
                }, {
                    argCount: "?",
                    bang: true,
                    completer: function (context) completion.help(context, consolidated),
                    literal: 0
                });
        });
    },
    completion: function initCompletion(dactyl, modules, window) {
        const { completion } = modules;

        completion.help = function completion_help(context, consolidated) {
            dactyl.initHelp();
            context.title = ["Help"];
            context.anchored = false;
            context.completions = help.tags;
            if (consolidated)
                context.keys = { text: 0, description: function () "all" };
        };
    },
    javascript: function initJavascript(dactyl, modules, window) {
        modules.JavaScript.setCompleter([modules.help.exportHelp],
            [(context, args) => overlay.activeModules.completion.file(context)]);
    },
    options: function initOptions(dactyl, modules, window) {
        const { options } = modules;

        options.add(["helpfile", "hf"],
            "Name of the main help file",
            "string", "intro");
    }
});

endModule();

// vim: set fdm=marker sw=4 sts=4 ts=8 et ft=javascript:
