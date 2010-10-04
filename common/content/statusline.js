// Copyright (c) 2006-2008 by Martin Stubenschrott <stubenschrott@vimperator.org>
// Copyright (c) 2007-2009 by Doug Kearns <dougkearns@gmail.com>
// Copyright (c) 2008-2010 by Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

/** @scope modules */

const StatusLine = Module("statusline", {
    init: function () {
        this._statusLine = document.getElementById("status-bar");
        this.statusBar = document.getElementById("addon-bar") || this._statusLine;
        this.statusBar.collapsed = true; // it is later restored unless the user sets laststatus=0

        // our status bar fields
        this.widgets = array(["container", "url", "inputbuffer", "progress", "tabcount", "bufferposition", "zoomlevel"]
                    .map(function (field) [field, document.getElementById("dactyl-statusline-field-" + field)]))
                    .toObject();
        this.widgets.status = this.widgets.container;

        if (this.statusBar.localName == "toolbar") {
            styles.addSheet(true, "addon-bar", config.styleableChrome, <css><![CDATA[
                #status-bar { margin-top: 0 !important; }
                #addon-bar { padding: 0 !important; min-height: 18px !important; }
                #addon-bar > statusbar { -moz-box-flex: 1 }
            ]]></css>);
            let parent = this.widgets.status.parentNode;
            parent.removeChild(this.widgets.status);
            parent.insertBefore(this.widgets.status, parent.firstChild);
        }
    },

    get visible() !this.statusBar.collapsed,

    /**
     * Update the status bar to indicate how secure the website is:
     * extended - Secure connection with Extended Validation(EV) certificate.
     * secure -   Secure connection with valid certificate.
     * broken -   Secure connection with invalid certificate, or
     *            mixed content.
     * insecure - Insecure connection.
     *
     * @param {'extended'|'secure'|'broken'|'insecure'} type
     */
    setClass: function setClass(type) {
        const highlightGroup = {
            extended: "StatusLineExtended",
            secure:   "StatusLineSecure",
            broken:   "StatusLineBroken",
            insecure: "StatusLine"
        };

        highlight.highlightNode(this._statusLine, highlightGroup[type]);
    },

    // update all fields of the statusline
    update: function update() {
        this.updateUrl();
        this.updateInputBuffer();
        this.updateProgress();
        this.updateTabCount();
        this.updateBufferPosition();
        this.updateZoomLevel();
    },

    /**
     * Update the URL displayed in the status line. Also displays status
     * icons, [+-♥], when there are next and previous pages in the
     * current tab's history, and when the current URL is bookmarked,
     * respectively.
     *
     * @param {string} url The URL to display.
     * @default buffer.URL
     */
    updateUrl: function updateUrl(url) {
        // ripped from Firefox; modified
        function losslessDecodeURI(url) {
            // 1. decodeURI decodes %25 to %, which creates unintended
            //    encoding sequences.
            url = url.split("%25").map(function (url) {
                    // Non-UTF-8 complient URLs cause "malformed URI sequence" errors.
                    try {
                        return decodeURI(url);
                    }
                    catch (e) {
                        return url;
                    }
                }).join("%25");
            // 2. Re-encode whitespace so that it doesn't get eaten away
            //    by the location bar (bug 410726).
            url = url.replace(/[\r\n\t]/g, encodeURIComponent);

            // Encode invisible characters (soft hyphen, zero-width space, BOM,
            // line and paragraph separator, word joiner, invisible times,
            // invisible separator, object replacement character) (bug 452979)
            url = url.replace(/[\v\x0c\x1c\x1d\x1e\x1f\u00ad\u200b\ufeff\u2028\u2029\u2060\u2062\u2063\ufffc]/g,
                encodeURIComponent);

            // Encode bidirectional formatting characters.
            // (RFC 3987 sections 3.2 and 4.1 paragraph 6)
            url = url.replace(/[\u200e\u200f\u202a\u202b\u202c\u202d\u202e]/g,
                encodeURIComponent);
            return url;
        };

        // TODO: this probably needs a more general solution.
        if (url == null)
            url = buffer.URL;

        // when session information is available, add [+] when we can go
        // backwards, [-] when we can go forwards
        let modified = "";
        if (window.getWebNavigation) {
            let sh = window.getWebNavigation().sessionHistory;
            if (sh && sh.index > 0)
                modified += "+";
            if (sh && sh.index < sh.count - 1)
                modified += "-";
        }
        if (modules.bookmarks) {
            if (bookmarks.isBookmarked(buffer.URL))
                modified += UTF8("❤");
                //modified += UTF8("♥");
        }
        if (modules.quickmarks)
            modified += quickmarks.find(url.replace(/#.*/, "")).join("");

        url = losslessDecodeURI(url);

        // make it even more Vim-like
        if (url == "about:blank") {
            if (!buffer.title)
                url = "[No Name]";
        }
        else {
            url = url.replace(RegExp("^dactyl://help/(\\S+)#(.*)"), function (m, n1, n2) n1 + " " + decodeURIComponent(n2) + " [Help]")
                     .replace(RegExp("^dactyl://help/(\\S+)"), "$1 [Help]");
        }

        if (modified)
            url += " [" + modified + "]";

        this.widgets.url.value = url;
    },

    /**
     * Set the contents of the status line's input buffer to the given
     * string. Used primarily when a key press requires further input
     * before being processed, including mapping counts and arguments,
     * along with multi-key mappings.
     *
     * @param {string} buffer
     */
    updateInputBuffer: function updateInputBuffer(buffer) {
        if (!buffer || typeof buffer != "string")
            buffer = "";

        this.widgets.inputbuffer.value = buffer;
    },

    /**
     * Update the page load progress bar.
     *
     * @param {string|number} progress The current progress, as follows:
     *    A string          - Displayed literally.
     *    A ratio 0 < n < 1 - Displayed as a progress bar.
     *    A number n <= 0   - Displayed as a "Loading" message.
     *    Any other number  - The progress is cleared.
     */
    progress: Modes.boundProperty({
        set: function setProgress(progress) {
            if (!progress)
                progress = "";

            if (typeof progress == "string")
                this.widgets.progress.value = progress;
            else if (typeof progress == "number") {
                let progressStr = "";
                if (progress <= 0)
                    progressStr = "[ Loading...         ]";
                else if (progress < 1) {
                    progress = Math.floor(progress * 20);
                    progressStr = "["
                        + "====================".substr(0, progress)
                        + ">"
                        + "                    ".substr(0, 19 - progress)
                        + "]";
                }
                this.widgets.progress.value = progressStr;
            }
        }
    }),
    updateProgress: function updateProgress(progress) {
        this.progress = progress;
    },

    /**
     * Display the correct tabcount (e.g., [1/5]) on the status bar.
     *
     * @param {bool} delayed When true, update count after a
     *      brief timeout. Useful in the many cases when an
     *      event that triggers an update is broadcast before
     *      the tab state is fully updated.
     */
    updateTabCount: function updateTabCount(delayed) {
        if (dactyl.has("tabs")) {
            if (delayed) {
                this.timeout(function () this.updateTabCount(false), 0);
                return;
            }

            // update the ordinal which is used for numbered tabs
            if (options.get("guioptions").has("n", "N"))
                for (let [i, tab] in Iterator(tabs.visibleTabs))
                    tab.setAttribute("ordinal", i + 1);

            this.widgets.tabcount.value = "[" + (tabs.index(null, true) + 1) + "/" + tabs.visibleTabs.length + "]";
        }
    },

    /**
     * Display the main content's vertical scroll position in the status
     * bar.
     *
     * @param {number} percent The position, as a percentage. @optional
     */
    updateBufferPosition: function updateBufferPosition(percent) {
        if (typeof percent != "number") {
            let win = document.commandDispatcher.focusedWindow;
            if (!win)
                return;
            win.scrollY;
            percent = win.scrollY    == 0 ?  0 : // This prevents a forced rendering
                      win.scrollMaxY == 0 ? -1 : win.scrollY / win.scrollMaxY;
        }

        let bufferPositionStr = "";
        percent = Math.round(percent * 100);
        if (percent < 0)
            bufferPositionStr = "All";
        else if (percent == 0)
            bufferPositionStr = "Top";
        else if (percent >= 100)
            bufferPositionStr = "Bot";
        else if (percent < 10)
            bufferPositionStr = " " + percent + "%";
        else
            bufferPositionStr = percent + "%";

        this.widgets.bufferposition.value = bufferPositionStr;
    },

    /**
     * Display the main content's zoom level.
     *
     * @param {number} percent The zoom level, as a percentage. @optional
     * @param {boolean} full True if full zoom is in operation. @optional
     */
    updateZoomLevel: function updateZoomLevel(percent, full) {
        if (arguments.length == 0)
            [percent, full] = [buffer.zoomLevel, buffer.fullZoom];

        if (percent == 100)
            this.widgets.zoomlevel.value = "";
        else {
            percent = ("  " + percent).substr(-3);
            if (full)
                this.widgets.zoomlevel.value = " [" + percent + "%]";
            else
                this.widgets.zoomlevel.value = " (" + percent + "%)";
        }
    }

}, {
}, {
    options: function () {
        options.add(["laststatus", "ls"],
            "Show the status line",
            "number", 2,
            {
                setter: function setter(value) {
                    if (value == 0)
                        statusline.statusBar.collapsed = true;
                    else if (value == 1)
                        dactyl.echoerr("show status line only with > 1 window not implemented yet");
                    else
                        statusline.statusBar.collapsed = false;
                    commandline.widgets.updateVisibility();
                    return value;
                },
                completer: function completer(context) [
                    ["0", "Never display status line"],
                    ["1", "Display status line only if there are multiple windows"],
                    ["2", "Always display status line"]
                ]
            });
    }
});

// vim: set fdm=marker sw=4 ts=4 et:
