"use strict";

var utils = require("utils");
const { module } = utils;

var { interfaces: Ci } = Components;
var { nsIDOMKeyEvent: KeyEvent } = Ci;

var controller, dactyl;
var dactyllib = module("dactyl");
var jumlib = module("resource://mozmill/modules/jum.js");

var setupModule = function (module) {
    controller = mozmill.getBrowserController();
    dactyl = new dactyllib.Controller(controller);
};
var teardownModule = function (module) {
    dactyl.teardown();
}

var keyDefaults = {
    keyCode: 0,
    charCode: 0,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false
};

var keyMap = {
    "a": {
        charCode: "a".charCodeAt(0)
    },
    "A": {
        charCode: "A".charCodeAt(0),
        shiftKey: true
    },
    "<C-a>": {
        aliases: ["<C-A>"],
        charCode: "a".charCodeAt(0),
        ctrlKey: true,
    },
    "<C-S-A>": {
        aliases: ["<C-S-a>"],
        charCode: "A".charCodeAt(0),
        ctrlKey: true,
        shiftKey: true,
    },
    "<Return>": {
        aliases: ["<CR>"],
        keyCode: KeyEvent.DOM_VK_RETURN
    },
    "<S-Return>": {
        aliases: ["<S-CR>"],
        keyCode: KeyEvent.DOM_VK_RETURN,
        shiftKey: true
    },
    "<Space>": {
        aliases: [" ", "< >"],
        charCode: " ".charCodeAt(0)
    }
};

function testKeys() {
    let { DOM, update } = dactyl.modules;

    for (let [name, object] in Iterator(keyMap)) {
        for each (let key in (object.aliases || []).concat(name)) {
            dactyl.assertNoErrors(function () {
                let result = DOM.Event.parse(key);
                jumlib.assertEquals(result.length, 1);

                for (let [k, v] in Iterator(keyDefaults))
                    if (k != "keyCode" || "keyCode" in object || result.keyCode == 0) // TODO
                        jumlib.assertEquals(result[0][k],
                                            k in object ? object[k] : v,
                                            name + ":" + key + ":" + k);

                jumlib.assertEquals(DOM.Event.stringify(result[0]),
                                    name);
            });
        }

        jumlib.assertEquals(name,
                            DOM.Event.stringify(
                                update({ type: "keypress" },
                                       keyDefaults,
                                       object)));
    }
}

// vim: sw=4 ts=8 et:
