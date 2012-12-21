// Copyright (c) 2011-2012 Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

defineModule("downloads", {
    exports: ["Download", "Downloads", "downloads"],
    require: ["util"]
});

lazyRequire("overlay", ["overlay"]);

Cu.import("resource://gre/modules/DownloadUtils.jsm", this);

let prefix = "DOWNLOAD_";
var states = iter([v, k.slice(prefix.length).toLowerCase()]
                  for ([k, v] in Iterator(Ci.nsIDownloadManager))
                  if (k.indexOf(prefix) == 0))
                .toObject();

var Download = Class("Download", {
    init: function init(id, list) {
        let self = this;
        this.download = services.downloadManager.getDownload(id);
        this.list = list;

        this.nodes = {
            commandTarget: self
        };
        DOM.fromJSON(
            ["tr", { highlight: "Download", key: "row" },
                ["td", { highlight: "DownloadTitle" },
                    ["span", { highlight: "Link" },
                        ["a", { key: "launch", href: self.target.spec, path: self.targetFile.path },
                            self.displayName],
                        ["span", { highlight: "LinkInfo" },
                            self.targetFile.path]]],
                ["td", { highlight: "DownloadState", key: "state" }],
                ["td", { highlight: "DownloadButtons Buttons" },
                    ["a", { highlight: "Button", href: "javascript:0", key: "pause" }, _("download.action.Pause")],
                    ["a", { highlight: "Button", href: "javascript:0", key: "remove" }, _("download.action.Remove")],
                    ["a", { highlight: "Button", href: "javascript:0", key: "resume" }, _("download.action.Resume")],
                    ["a", { highlight: "Button", href: "javascript:0", key: "retry" }, _("download.action.Retry")],
                    ["a", { highlight: "Button", href: "javascript:0", key: "cancel" }, _("download.action.Cancel")],
                    ["a", { highlight: "Button", href: "javascript:0", key: "delete" }, _("download.action.Delete")]],
                ["td", { highlight: "DownloadProgress", key: "progress" },
                    ["span", { highlight: "DownloadProgressHave", key: "progressHave" }],
                    "/",
                    ["span", { highlight: "DownloadProgressTotal", key: "progressTotal" }]],,
                ["td", { highlight: "DownloadPercent", key: "percent" }],
                ["td", { highlight: "DownloadSpeed", key: "speed" }],
                ["td", { highlight: "DownloadTime", key: "time" }],
                ["td", {},
                    ["a", { highlight: "DownloadSource", key: "source", href: self.source.spec },
                        self.source.spec]]],
            this.list.document, this.nodes);

        this.nodes.launch.addEventListener("click", function (event) {
            if (event.button == 0) {
                event.preventDefault();
                self.command("launch");
            }
        }, false);

        self.updateStatus();
        return self;
    },

    get status() states[this.state],

    inState: function inState(states) states.indexOf(this.status) >= 0,

    get alive() this.inState(["downloading", "notstarted", "paused", "queued", "scanning"]),

    allowedCommands: Class.Memoize(function () let (self = this) ({
        get cancel() self.cancelable && self.inState(["downloading", "paused", "starting"]),
        get delete() !this.cancel && self.targetFile.exists(),
        get launch() self.targetFile.exists() && self.inState(["finished"]),
        get pause() self.inState(["downloading"]),
        get remove() self.inState(["blocked_parental", "blocked_policy",
                                   "canceled", "dirty", "failed", "finished"]),
        get resume() self.resumable && self.inState(["paused"]),
        get retry() self.inState(["canceled", "failed"])
    })),

    command: function command(name) {
        util.assert(Set.has(this.allowedCommands, name), _("download.unknownCommand"));
        util.assert(this.allowedCommands[name], _("download.commandNotAllowed"));

        if (Set.has(this.commands, name))
            this.commands[name].call(this);
        else
            services.downloadManager[name + "Download"](this.id);
    },

    commands: {
        delete: function delete_() {
            this.targetFile.remove(false);
            this.updateStatus();
        },
        launch: function launch() {
            let self = this;
            // Behavior mimics that of the builtin Download Manager.
            function action() {
                try {
                    if (this.MIMEInfo && this.MIMEInfo.preferredAction == this.MIMEInfo.useHelperApp)
                        this.MIMEInfo.launchWithFile(file.file);
                    else
                        file.launch();
                }
                catch (e) {
                    services.externalProtocol.loadUrl(this.target);
                }
            }

            let file = io.File(this.targetFile);
            if (file.isExecutable() && prefs.get("browser.download.manager.alertOnEXEOpen", true))
                this.list.modules.commandline.input(_("download.prompt.launchExecutable") + " ",
                    function (resp) {
                        if (/^a(lways)$/i.test(resp)) {
                            prefs.set("browser.download.manager.alertOnEXEOpen", false);
                            resp = "yes";
                        }
                        if (/^y(es)?$/i.test(resp))
                            action.call(self);
                    });
            else
                action.call(this);
        }
    },

    _compare: {
        active: function (a, b) a.alive - b.alive,
        complete: function (a, b) a.percentComplete - b.percentComplete,
        date: function (a, b) a.startTime - b.startTime,
        filename: function (a, b) String.localeCompare(a.targetFile.leafName, b.targetFile.leafName),
        size: function (a, b) a.size - b.size,
        speed: function (a, b) a.speed - b.speed,
        time: function (a, b) a.timeRemaining - b.timeRemaining,
        url: function (a, b) String.localeCompare(a.source.spec, b.source.spec)
    },

    compare: function compare(other) values(this.list.sortOrder).map(function (order) {
        let val = this._compare[order.substr(1)](this, other);

        return (order[0] == "-") ? -val : val;
    }, this).nth(util.identity, 0) || 0,

    timeRemaining: Infinity,

    updateProgress: function updateProgress() {
        let self = this.__proto__;

        if (this.amountTransferred === this.size) {
            this.nodes.speed.textContent = "";
            this.nodes.time.textContent = "";
        }
        else {
            this.nodes.speed.textContent = util.formatBytes(this.speed, 1, true) + "/s";

            if (this.speed == 0 || this.size == 0)
                this.nodes.time.textContent = _("download.unknown");
            else {
                let seconds = (this.size - this.amountTransferred) / this.speed;
                [, self.timeRemaining] = DownloadUtils.getTimeLeft(seconds, this.timeRemaining);
                if (this.timeRemaining)
                    this.nodes.time.textContent = util.formatSeconds(this.timeRemaining);
                else
                    this.nodes.time.textContent = _("download.almostDone");
            }
        }

        let total = this.nodes.progressTotal.textContent = this.size || !this.nActive ? util.formatBytes(this.size, 1, true)
                                                                                      : _("download.unknown");
        let suffix = RegExp(/( [a-z]+)?$/i.exec(total)[0] + "$");
        this.nodes.progressHave.textContent = util.formatBytes(this.amountTransferred, 1, true).replace(suffix, "");

        this.nodes.percent.textContent = this.size ? Math.round(this.amountTransferred * 100 / this.size) + "%" : "";
    },

    updateStatus: function updateStatus() {

        this.nodes.row[this.alive ? "setAttribute" : "removeAttribute"]("active", "true");

        this.nodes.row.setAttribute("status", this.status);
        this.nodes.state.textContent = util.capitalize(this.status);

        for (let node in values(this.nodes))
            if (node.update)
                node.update();

        this.updateProgress();
    }
});
Object.keys(XPCOMShim([Ci.nsIDownload])).forEach(function (key) {
    if (!(key in Download.prototype))
        Object.defineProperty(Download.prototype, key, {
            get: function get() this.download[key],
            set: function set(val) this.download[key] = val,
            configurable: true
        });
});

var DownloadList = Class("DownloadList",
                         XPCOM([Ci.nsIDownloadProgressListener,
                                Ci.nsIObserver,
                                Ci.nsISupportsWeakReference]), {
    init: function init(modules, filter, sort) {
        this.sortOrder = sort;
        this.modules = modules;
        this.filter = filter && filter.toLowerCase();
        this.nodes = {
            commandTarget: this
        };
        this.downloads = {};
    },

    cleanup: function cleanup() {
        this.observe.unregister();
        services.downloadManager.removeListener(this);
    },

    message: Class.Memoize(function () {

        DOM.fromJSON(["table", { highlight: "Downloads", key: "list" },
                        ["tr", { highlight: "DownloadHead", key: "head" },
                            ["span", {}, _("title.Title")],
                            ["span", {}, _("title.Status")],
                            ["span"],
                            ["span", {}, _("title.Progress")],
                            ["span"],
                            ["span", {}, _("title.Speed")],
                            ["span", {}, _("title.Time remaining")],
                            ["span", {}, _("title.Source")]],
                        ["tr", { highlight: "Download" },
                            ["span", {},
                                ["div", { style: "min-height: 1ex; /* FIXME */" }]]],
                        ["tr", { highlight: "Download", key: "totals", active: "true" },
                            ["td", {},
                                ["span", { highlight: "Title" },
                                    _("title.Totals") + ":"],
                                " ",
                                ["span", { key: "total" }]],
                            ["td"],
                            ["td", { highlight: "DownloadButtons" },
                                ["a", { highlight: "Button", href: "javascript:0", key: "clear" }, _("download.action.Clear")]],
                            ["td", { highlight: "DownloadProgress", key: "progress" },
                                ["span", { highlight: "DownloadProgressHave", key: "progressHave" }],
                                "/",
                                ["span", { highlight: "DownloadProgressTotal", key: "progressTotal" }]],
                            ["td", { highlight: "DownloadPercent", key: "percent" }],
                            ["td", { highlight: "DownloadSpeed", key: "speed" }],
                            ["td", { highlight: "DownloadTime", key: "time" }],
                            ["td"]]],
                      this.document, this.nodes);

        this.index = Array.indexOf(this.nodes.list.childNodes,
                                   this.nodes.head);

        for (let row in iter(services.downloadManager.DBConnection
                                     .createStatement("SELECT id FROM moz_downloads")))
            this.addDownload(row.id);
        this.update();

        util.addObserver(this);
        services.downloadManager.addListener(this);
        return this.nodes.list;
    }),

    addDownload: function addDownload(id) {
        if (!(id in this.downloads)) {
            let download = Download(id, this);
            if (this.filter && download.displayName.indexOf(this.filter) === -1)
                return;

            this.downloads[id] = download;
            let index = values(this.downloads).sort(function (a, b) a.compare(b))
                                              .indexOf(download);

            this.nodes.list.insertBefore(download.nodes.row,
                                         this.nodes.list.childNodes[index + this.index + 1]);
        }
    },
    removeDownload: function removeDownload(id) {
        if (id in this.downloads) {
            this.nodes.list.removeChild(this.downloads[id].nodes.row);
            delete this.downloads[id];
        }
    },

    leave: function leave(stack) {
        if (stack.pop)
            this.cleanup();
    },

    allowedCommands: Class.Memoize(function () let (self = this) ({
        get clear() values(self.downloads).some(function (dl) dl.allowedCommands.remove)
    })),

    commands: {
        clear: function () {
            services.downloadManager.cleanUp();
        }
    },

    sort: function sort() {
        let list = values(this.downloads).sort(function (a, b) a.compare(b));

        for (let [i, download] in iter(list))
            if (this.nodes.list.childNodes[i + 1] != download.nodes.row)
                this.nodes.list.insertBefore(download.nodes.row,
                                             this.nodes.list.childNodes[i + 1]);
    },

    shouldSort: function shouldSort() Array.some(arguments, function (val) this.sortOrder.some(function (v) v.substr(1) == val), this),

    update: function update() {
        for (let node in values(this.nodes))
            if (node.update && node.update != update)
                node.update();
        this.updateProgress();

        let event = this.document.createEvent("Events");
        event.initEvent("dactyl-commandupdate", true, false);
        this.document.dispatchEvent(event);
    },

    timeRemaining: Infinity,

    updateProgress: function updateProgress() {
        let downloads = values(this.downloads).toArray();
        let active    = downloads.filter(function (d) d.alive);

        let self = Object.create(this);
        for (let prop in values(["amountTransferred", "size", "speed", "timeRemaining"]))
            this[prop] = active.reduce(function (acc, dl) dl[prop] + acc, 0);

        Download.prototype.updateProgress.call(self);

        this.nActive = active.length;
        if (active.length)
            this.nodes.total.textContent = _("download.nActive", active.length);
        else for (let key in values(["total", "percent", "speed", "time"]))
            this.nodes[key].textContent = "";

        if (this.shouldSort("complete", "size", "speed", "time"))
            this.sort();
    },

    observers: {
        "download-manager-remove-download": function (id) {
            if (id == null)
                id = [k for ([k, dl] in iter(this.downloads)) if (dl.allowedCommands.remove)];
            else
                id = [id.QueryInterface(Ci.nsISupportsPRUint32).data];

            Array.concat(id).map(this.closure.removeDownload);
            this.update();
        }
    },

    onDownloadStateChange: function (state, download) {
        try {
            if (download.id in this.downloads)
                this.downloads[download.id].updateStatus();
            else {
                this.addDownload(download.id);

                this.modules.mow.resize(false);
                this.nodes.list.scrollIntoView(false);
            }
            this.update();

            if (this.shouldSort("active"))
                this.sort();
        }
        catch (e) {
            util.reportError(e);
        }
    },

    onProgressChange: function (webProgress, request,
                                curProgress, maxProgress,
                                curTotalProgress, maxTotalProgress,
                                download) {
        try {
            if (download.id in this.downloads)
                this.downloads[download.id].updateProgress();
            this.updateProgress();
        }
        catch (e) {
            util.reportError(e);
        }
    }
});

var Downloads = Module("downloads", XPCOM(Ci.nsIDownloadProgressListener), {
    init: function () {
        services.downloadManager.addListener(this);
    },

    cleanup: function destroy() {
        services.downloadManager.removeListener(this);
    },

    onDownloadStateChange: function (state, download) {
        if (download.state == services.downloadManager.DOWNLOAD_FINISHED) {
            let url   = download.source.spec;
            let title = download.displayName;
            let file  = download.targetFile.path;
            let size  = download.size;


            overlay.modules.forEach(function (modules) {
                modules.dactyl.echomsg({ domains: [util.getHost(url)], message: _("io.downloadFinished", title, file) },
                                       1, modules.commandline.ACTIVE_WINDOW);
                modules.autocommands.trigger("DownloadPost", { url: url, title: title, file: file, size: size });
            });
        }
    }
}, {
}, {
    commands: function initCommands(dactyl, modules, window) {
        const { commands, CommandOption } = modules;

        commands.add(["downl[oads]", "dl"],
            "Display the downloads list",
            function (args) {
                let downloads = DownloadList(modules, args[0], args["-sort"]);
                modules.commandline.echo(downloads);
            },
            {
                argCount: "?",
                options: [
                    {
                        names: ["-sort", "-s"],
                        description: "Sort order (see 'downloadsort')",
                        type: CommandOption.LIST,
                        get default() modules.options["downloadsort"],
                        completer: function (context, args) modules.options.get("downloadsort").completer(context, { values: args["-sort"] }),
                        validator: function (value) modules.options.get("downloadsort").validator(value)
                    }
                ]
            });

        commands.add(["dlc[lear]"],
            "Clear completed downloads",
            function (args) { services.downloadManager.cleanUp(); });
    },
    options: function initOptions(dactyl, modules, window) {
        const { options } = modules;

        if (false)
        options.add(["downloadcolumns", "dlc"],
            "The columns to show in the download manager",
            "stringlist", "filename,state,buttons,progress,percent,time,url",
            {
                values: {
                    buttons:    "Control buttons",
                    filename:   "Target filename",
                    percent:    "Percent complete",
                    size:       "File size",
                    speed:      "Download speed",
                    state:      "The download's state",
                    time:       "Time remaining",
                    url:        "Source URL"
                }
            });

        options.add(["downloadsort", "dlsort", "dls"],
            ":downloads sort order",
            "stringlist", "-active,+filename",
            {
                values: {
                    active:     "Whether download is active",
                    complete:   "Percent complete",
                    date:       "Date and time the download began",
                    filename:   "Target filename",
                    size:       "File size",
                    speed:      "Download speed",
                    time:       "Time remaining",
                    url:        "Source URL"
                },

                completer: function (context, extra) {
                    let seen = Set.has(Set(extra.values.map(function (val) val.substr(1))));

                    context.completions = iter(this.values).filter(function ([k, v]) !seen(k))
                                                           .map(function ([k, v]) [["+" + k, [v, " (", _("sort.ascending"), ")"].join("")],
                                                                                   ["-" + k, [v, " (", _("sort.descending"), ")"].join("")]])
                                                           .flatten().array;
                },

                has: function () Array.some(arguments, function (val) this.value.some(function (v) v.substr(1) == val)),

                validator: function (value) {
                    let seen = {};
                    return value.every(function (val) /^[+-]/.test(val) && Set.has(this.values, val.substr(1))
                                                                        && !Set.add(seen, val.substr(1)),
                                       this) && value.length;
                }
            });
    }
});

endModule();

// catch(e){ if (isString(e)) e = Error(e); dump(e.fileName+":"+e.lineNumber+": "+e+"\n" + e.stack); }

// vim: set fdm=marker sw=4 ts=4 et ft=javascript:
