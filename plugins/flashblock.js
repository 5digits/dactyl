"use strict";
var INFO =
["plugin", { name: "flashblock",
             version: "1.3",
             href: "http://dactyl.sf.net/pentadactyl/plugins#flashblock-plugin",
             summary: "Flash Blocker",
             xmlns: "dactyl" },
    ["author", { email: "maglione.k@gmail.com" },
        "Kris Maglione"],
    ["license", { href: "http://opensource.org/licenses/mit-license.php" },
        "MIT"],
    ["project", { name: "Pentadactyl", "min-version": "1.0" }],
    ["p", {},
        "This plugin provides the same features as the ever popular FlashBlock ",
        "Firefox add-on. Place holders are substituted for flash animations and ",
        "embedded videos. When clicked, the original embedded content is ",
        "restored. Additionally, this plugin provides options to control which ",
        "sites can play animations without restrictions and triggers to toggle ",
        "the playing of animations on the current page."],

    ["item", {},
        ["tags", {}, "'fb' 'flashblock'"],
        ["spec", {}, "'flashblock' 'fb'"],
        ["type", {}, "boolean"],
        ["default", {}, "true"],
        ["description", {},
            ["p", {},
                "Controls the blocking of flash animations. When true, place ",
                "holders are substituted for flash animations on untrusted sites."]]],

    ["item", {},
        ["tags", {}, "'fbw' 'fbwhitelist'"],
        ["spec", {}, "'fbwhitelist' 'fbw'"],
        ["type", {}, "sitelist"],
        ["default", {}, ""],
        ["description", {},
            ["p", {},
                "Controls which sites may play flash animations without user ",
                "intervention. See ", ["ex", {}, ":mk" + config.name.toLowerCase() + "rc"], "."]]],

    ["item", {},
        ["tags", {}, ":flashplay :flp"],
        ["strut"],
        ["spec", {}, ":flashplay"],
        ["description", {},
            ["p", {},
                "Plays any blocked flash animations on the current page."]]],

    ["item", {},
        ["tags", {}, ":flashstop :fls"],
        ["strut"],
        ["spec", {}, ":flashstop"],
        ["description", {},
            ["p", {},
                "Stops any currently playing flash animations on the current ",
                "page."]]],

    ["item", {},
        ["tags", {}, ":flashtoggle :flt"],
        ["strut"],
        ["spec", {}, ":flashtoggle"],
        ["description", {},
            ["p", {},
                "Toggles the playing of all animations on the current page. If ",
                "any flash animations are currently blocked, all may begin ",
                "playing. Otherwise, all animations are stopped."],

            ["example", {},
                ["ex", {}, ":map"], " -silent ",
                ["k", { name: "A-p", link: "false" }],
                " ", ["ex", {}, ":flashtoggle"],
                ["k", { name: "CR" }]]]]];

group.options.add(["flashblock", "fb"],
    "Enable blocking of flash animations",
    "boolean", true,
    { setter: reload });
group.options.add(["fbwhitelist", "fbw"],
    "Sites which may run flash animations without prompting",
    "sitelist", "",
    {
        completer: context => completion.visibleHosts(context),
        privateData: true,
        setter: reload,
        validator: () => true,
    });

["Play", "Stop"].forEach(action => {
    group.commands.add(["flash" + action, "fl" + action[0]].map(String.toLowerCase),
        action + " all flash animations on the current page",
        function () { postMessage(content, "flashblock" + action) },
        { argCount: "0" }, true);
});

group.commands.add(["flashtoggle", "flt"],
    "Toggle playing of flash animations on the current page",
    function () {
        if (buffer.allFrames().some(w => DOM("pseudoembed", w.document).length))
            commands.get("flashplay").action();
        else
            commands.get("flashstop").action();
    },
    { argCount: "0" }, true);

group.mappings.add([modes.NORMAL], ["<Leader>fbwhitelist"],
    "Add the current site to the flash whitelist",
    function () { whitelist.op("+", whitelist.parse(content.location.hostname)) });
group.mappings.add([modes.NORMAL], ["<Leader>fbWhitelist"],
    "Toggle the current site in the flash whitelist",
    function () {
        let host = content.location.hostname;
        if (!removeHost(host))
            whitelist.op("+", whitelist.parse(host));
    });

var enabled = options.get("flashblock");
var whitelist = options.get("fbwhitelist");
function postMessage(content, message) {
    buffer.allFrames(content).forEach(f => { f.postMessage(message, "*"); });
}
function reload(values) {
    //for (let [,t] in tabs.browsers)
    //    t.contentWindow.postMessage("flashblockReload", "*");
    postMessage(gBrowser.mCurrentBrowser.contentWindow, "flashblockReload");
    return values;
}

function removeHost(host) {
    let len = whitelist.value.length;
    let uri = util.createURI(host);
    whitelist.value = whitelist.value.filter(f => !f(uri));
    return whitelist.value.length != len;
}

function onUnload() {
    group.events.unlisten(null);
}
group.events.listen(window, "flashblockCheckLoad",
    function checkLoadFlash(event) {
        if(!enabled.value || whitelist.getKey(event.target.documentURIObject))
            event.preventDefault();
        event.stopPropagation();
    }, true, true);

var data = {
    bindings: "dactyl://data/text/xml," + encodeURIComponent('<?xml version="1.0"?>' +
      String.raw`
        <bindings
           xmlns="http://www.mozilla.org/xbl"
           xmlns:xbl="http://www.mozilla.org/xbl"
           xmlns:html="http://www.w3.org/1999/xhtml">

          <binding id="flash">
            <implementation>
              <constructor>
                <![CDATA[
                    var myDocument = XPCNativeWrapper(document);
                    var myWindow = XPCNativeWrapper(window);

                    function copyAttribs(to, from) {
                        Array.map(from.attributes, function(attrib) {
                            to.setAttribute(attrib.name, attrib.value);
                        });
                    }
                    function capitalize(str) { return str[0].toUpperCase() + str.substr(1) };

                    function Placeholder(embed) {
                        var self = this;
                        this.embed = embed;

                        if (!document.flashblockStyle) {
                            var head = document.getElementsByTagName("head")[0];
                            var node = document.createElement("style");
                            node.setAttribute("type", "text/css");
                            head.insertBefore(node, head.firstChild);
                            document.flashblockStyle = node.sheet;
                        }

                        document.flashblockIdx = (document.flashblockIdx || 0) + 1;
                        this.idx = document.flashblockIdx;
                        embed.setAttribute("flashblock", this.idx);

                        document.flashblockStyle.insertRule("pseudoembed[flashblock='" + this.idx + "'] {}", 0);
                        this.style = document.flashblockStyle.cssRules[0].style;

                        this.div = myDocument.createElement('pseudoembed');
                        this.div.addEventListener("click", function() { self.showEmbed(true) }, true);
                        this.div.flashblockEmbed = embed;
                    }
                    Placeholder.prototype = {
                        showEmbed: function(clicked) {
                            this.embed.clicked = clicked;
                            if (this.embed.parentNode)
                                return;
                            copyAttribs(this.embed, this.div);
                            this.div.parentNode.replaceChild(this.embed, this.div);
                        },
                        hideEmbed: function() {
                            let parent = this.embed.parentNode;
                            if (!parent)
                                return;

                            this.div.setAttribute("embedtype", this.embed.localName);
                            copyAttribs(this.div, this.embed);

                            ['width', 'height'].forEach(function(dimen) {
                                this.style[dimen] = "";
                                if (this.embed[dimen])
                                    if (/%$/.test(this.embed[dimen]))
                                        this.style[dimen] = this.embed[dimen];
                                    else
                                        this.style[dimen] = parseInt(this.embed[dimen]) + "px";
                            }, this);

                            let style = myWindow.getComputedStyle(parent, "");
                            if (style.getPropertyValue("text-align") == "center") {
                                this.style.marginRight = "auto";
                                this.style.marginLeft = "auto";
                            }

                            parent.replaceChild(this.div, this.embed);
                        }
                    }

                    var parent = this.parentNode
                    var self = this;
                    if (!this.getAttribute("flashblock"))
                        this.setAttribute("flashblock", true);
                    if (this.placeholder || parent.placeholder)
                        return;
                    this.placeholder = new Placeholder(self);

                    function checkReplace(e) {
                        if (!e || e.data == "flashblockReload") {
                            if (self.clicked)
                                return;
                            let event = myDocument.createEvent("UIEvents");
                            event.initEvent("flashblockCheckLoad", true, true);
                            myDocument.dispatchEvent(event);
                            if (event.getPreventDefault())
                                self.placeholder.showEmbed();
                            else
                                self.placeholder.hideEmbed();
                          }
                          else if (e.data == "flashblockPlay")
                              self.placeholder.showEmbed(true);
                          else if (e.data == "flashblockStop")
                              self.placeholder.hideEmbed();
                    }
                    checkReplace();
                    myWindow.addEventListener("message", checkReplace, false);

                    // if(this.src == this.ownerDocument.location)
                    //     myWindow.location = 'dactyl://data/application/xhtml+xml,' + encodeURIComponent('<?xml version="1.0" encoding="UTF-8"?>' +
                    //                         '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">' +
                    //         <html xmlns="http://www.w3.org/1999/xhtml">
                    //             <head><title></title></head>
                    //             <body>{new XML(parent.innerHTML)}</body>
                    //         </html>);
                ]]>
              </constructor>
            </implementation>
          </binding>
        </bindings>
      `),
    flash: `data:image/png;base64,
        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
    `,
    play: `data:image/png;base64,
        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
        AAMACHALg12qSjsAAAAASUVORK5CYII
    `,
};

var CSS =
    /*
     * Flash Click to View by Ted Mielczarek (luser_mozilla@perilith.com)
     * Original code by Jesse Ruderman (jruderman@hmc.edu)
     * taken from http://www.squarefree.com/userstyles/xbl.html
     *
     * Change XBL binding for <object> tags, click to view flash
     */
    String.raw`

    pseudoembed {
            display: inline-block;
            min-width: 32px !important;
            min-height: 32px !important;
            border: 1px solid #dfdfdf;
            cursor: pointer;
            overflow: hidden;
            -moz-box-sizing: border-box;
            background: url("${data.play}") no-repeat center;
    }
    pseudoembed:hover {
            background-image: url("${data.flash}");
    }

    video,
    object[classid*=":D27CDB6E-AE6D-11cf-96B8-444553540000"],
    object[codebase*="swflash.cab"],
    object[data*=".swf"],
    embed[type="application/x-shockwave-flash"],
    embed[src*=".swf"],
    object[type="application/x-shockwave-flash"],
    object[src*=".swf"] {
            -moz-binding: url("{bindings}") !important;
    }

    /// TODO: Could do better.
    /// NoScript is incredibly annoying. The binding can't execute JS on
    /// untrusted sites.
    video:not([flashblock]),
    object[classid*=":D27CDB6E-AE6D-11cf-96B8-444553540000"]:not([flashblock]),
    object[codebase*="swflash.cab"]:not([flashblock]),
    object[data*=".swf"]:not([flashblock]),
    embed[type="application/x-shockwave-flash"]:not([flashblock]),
    embed[src*=".swf"]:not([flashblock]),
    object[type="application/x-shockwave-flash"]:not([flashblock]),
    object[src*=".swf"]:not([flashblock]) {
        display: none !important;
    }

    /// Java identifiers.
    /// TODO: Make this work.
    /// applet,
    /// object[classid*=":8AD9C840-044E-11D1-B3E9-00805F499D93"],
    /// object[classid^="clsid:CAFEEFAC-"],
    /// object[classid^="java:"],
    /// object[type="application/x-java-applet"],
    /// embed[classid*=":8AD9C840-044E-11D1-B3E9-00805F499D93"],
    /// embed[classid^="clsid:CAFEEFAC-"],
    /// embed[classid^="java:"],
    /// embed[type="application/x-java-applet"]
    /// {
    ///      -moz-binding: url("{bindings}") !important;
    /// }
`.replace(/\/\/\/.*/gm, "");

styles.system.add("flashblock", "*", CSS);
data = null;
CSS = null;

/* vim:se sts=4 sw=4 et: */
