// Copyright (c) 2011 by Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

Components.utils.import("resource://dactyl/bootstrap.jsm");
defineModule("downloads", {
    exports: ["Download", "Downloads", "downloads"],
    use: ["io", "services", "template", "util"]
}, this);

Cu.import("resource://gre/modules/DownloadUtils.jsm", this);

let prefix = "DOWNLOAD_";
var states = iter([v, k.slice(prefix.length).toLowerCase()]
                  for ([k, v] in Iterator(Ci.nsIDownloadManager))
                  if (k.indexOf(prefix) == 0))
                .toObject();

var Download = Class("Download", {
    init: function init(id, document) {
        let self = XPCSafeJSObjectWrapper(services.downloadManager.getDownload(id));
        self.__proto__ = this;
        this.instance = this;

        this.nodes = {};
        util.xmlToDom(
            <li highlight="Download" key="row" xmlns:dactyl={NS} xmlns={XHTML}>
                <span highlight="DownloadTitle">
                    <span highlight="Link">
                        <a key="title" href={self.target.spec}>{self.displayName}</a>
                        <span highlight="LinkInfo">{self.targetFile.path}</span>
                    </span>
                </span>
                <span highlight="DownloadState" key="state"/>
                <span highlight="DownloadButtons">
                    <span highlight="Button" key="pause">Pause</span>
                    <span highlight="Button" key="remove">Remove</span>
                    <span highlight="Button" key="resume">Resume</span>
                    <span highlight="Button" key="retry">Retry</span>
                    <span highlight="Button" key="cancel">Cancel</span>
                    <span highlight="Button" key="delete">Delete</span>
                </span>
                <span highlight="DownloadProgress" key="progress">
                    <span highlight="DownloadProgressHave" key="progressHave"
                    />/<span highlight="DownloadProgressTotal" key="progressTotal"/>
                </span>
                <span highlight="DownloadPercent" key="percent"/>
                <span highlight="DownloadTime" key="time"/>
                <a highlight="DownloadSource" key="source" href={self.source.spec}>{self.source.spec}</a>
            </li>,
            document, this.nodes);

        for (let [key, node] in Iterator(this.nodes)) {
            node.dactylDownload = self;
            if (node.getAttributeNS(NS, "highlight") == "Button") {
                node.setAttributeNS(NS, "command", "download.command");
                update(node, {
                    set collapsed(collapsed) {
                        if (collapsed)
                            this.setAttribute("collapsed", "true");
                        else
                            this.removeAttribute("collapsed");
                    },
                    get collapsed() !!this.getAttribute("collapsed")
                });
            }
        }

        self.updateStatus();
        return self;
    },

    get status() states[this.state],

    inState: function inState(states) states.indexOf(this.status) >= 0,

    get alive() this.inState(["downloading", "notstarted", "paused", "queued", "scanning"]),

    allowed: Class.memoize(function () let (self = this) ({
        get cancel() self.cancelable && self.inState(["downloading", "paused", "starting"]),
        get delete() !this.cancel && self.targetFile.exists(),
        get pause() self.inState(["downloading"]),
        get remove() self.inState(["blocked_parental", "blocked_policy",
                                   "canceled", "dirty", "failed", "finished"]),
        get resume() self.resumable && self.inState(["paused"]),
        get retry() self.inState(["canceled", "failed"])
    })),

    command: function command(name) {
        util.assert(set.has(this.allowed, name), "Unknown command");
        util.assert(this.allowed[name], "Command not allowed");

        if (set.has(this.commands, name))
            this.commands[name].call(this);
        else
            services.downloadManager[name + "Download"](this.id);
    },

    commands: {
        delete: function delete() {
            this.targetFile.remove(false);
            this.updateStatus();
        }
    },

    compare: function compare(other) String.localeCompare(this.displayName, other.displayName),

    timeRemaining: Infinity,

    updateProgress: function updateProgress() {
        let self = this.__proto__;

        if (this.amountTransferred === this.size)
            this.nodes.time.textContent = "";
        else if (this.speed == 0 || this.size == 0)
            this.nodes.time.textContent = "Unknown";
        else {
            let seconds = (this.size - this.amountTransferred) / this.speed;
            [, self.timeRemaining] = DownloadUtils.getTimeLeft(seconds, this.timeRemaining);
            if (this.timeRemaining)
                this.nodes.time.textContent = util.formatSeconds(this.timeRemaining);
            else
                this.nodes.time.textContent = "~1 second";
        }
        let total = this.nodes.progressTotal.textContent = this.size ? util.formatBytes(this.size, 1, true) : "Unknown";
        let suffix = RegExp(/( [a-z]+)?$/i.exec(total)[0] + "$");
        this.nodes.progressHave.textContent = util.formatBytes(this.amountTransferred, 1, true).replace(suffix, "");

        this.nodes.percent.textContent = this.size ? Math.round(this.amountTransferred * 100 / this.size) + "%" : "";
    },

    updateStatus: function updateStatus() {

        this.nodes.state.textContent = util.capitalize(this.status);
        for (let [command, enabled] in Iterator(this.allowed))
            this.nodes[command].collapsed = !enabled;
        this.updateProgress();
    }
});

var DownloadList = Class("DownloadList",
                         XPCOM([Ci.nsIDownloadProgressListener,
                                Ci.nsIObserver,
                                Ci.nsISupportsWeakReference]), {
    init: function init(document, modules) {
        this.modules = modules;
        this.document = document;
        this.nodes = {};
        util.xmlToDom(<ul highlight="Downloads" key="list" xmlns={XHTML}>
                        <li highlight="DownloadHead">
                            <span>Title</span>
                            <span>Status</span>
                            <span></span>
                            <span>Progress</span>
                            <span></span>
                            <span>Time remaining</span>
                            <span>Source</span>
                        </li>
                      </ul>, this.document, this.nodes);

        this.downloads = {};
        for (let row in iter(services.downloadManager.DBConnection
                                     .createStatement("SELECT id FROM moz_downloads")))
            this.addDownload(row.id);

        util.addObserver(this);
        services.downloadManager.addListener(this);
    },
    cleanup: function cleanup() {
        this.observe.unregister();
        services.downloadManager.removeListener(this);
    },

    addDownload: function addDownload(id) {
        if (!(id in this.downloads)) {
            this.downloads[id] = Download(id, this.document);

            let index = values(this.downloads).sort(function (a, b) a.compare(b))
                                              .indexOf(this.downloads[id]);

            this.nodes.list.insertBefore(this.downloads[id].nodes.row,
                                         this.nodes.list.childNodes[index + 1]);
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

    observers: {
        "download-manager-remove-download": function (id) {
            if (id == null)
                id = [k for ([k, dl] in iter(this.downloads)) if (dl.allowed.remove)];
            else
                id = [id.QueryInterface(Ci.nsISupportsPRUint32).data];

            Array.concat(id).map(this.closure.removeDownload);
        }
    },

    onDownloadStateChange: function (state, download) {
        try {
            if (download.id in this.downloads)
                this.downloads[download.id].updateStatus();
            else {
                this.addDownload(download.id);

                this.modules.commandline.updateOutputHeight(true);
                this.nodes.list.scrollIntoView(false);
            }
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
        }
        catch (e) {
            util.reportError(e);
        }
    }
});

var Downloads = Module("downloads", {
}, {
}, {
    commands: function (dactyl, modules, window) {
        const { commands } = modules;

        commands.add(["downl[oads]", "dl"],
            "Display the downloads list",
            function (args) {
                modules.commandline.echo(function (doc) {
                    let downloads = DownloadList(doc, modules);
                    // Temporary and dangerous hack:
                    modules.modes.getStack(0).params = downloads;
                    return downloads.nodes.list;
                });
            });
    },
    dactyl: function (dactyl, modules, window) {
        dactyl.commands["download.command"] = function (event) {
            let elem = event.originalTarget;
            elem.dactylDownload.command(elem.getAttribute("key"));
        }
    }
});

endModule();

// catch(e){ if (isString(e)) e = Error(e); dump(e.fileName+":"+e.lineNumber+": "+e+"\n" + e.stack); }

// vim: set fdm=marker sw=4 ts=4 et ft=javascript:
