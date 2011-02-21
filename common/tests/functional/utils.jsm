
var EXPORTED_SYMBOLS = ["NS", "assert", "assertEqual", "module", "test", "toJSON"];

const Ci = Components.interfaces;

function module(uri) {
    if (!/^[a-z-]+:/.exec(uri))
        uri = /([^ ]+\/)[^\/]+$/.exec(Components.stack.caller.filename)[1] + uri + ".jsm";

    let obj = {};
    Components.utils.import(uri, obj);
    return obj;
}

var elementslib = module("resource://mozmill/modules/elementslib.js");
var frame = module("resource://mozmill/modules/frame.js");
var jumlib = module("resource://mozmill/modules/jum.js");

function toJSON(val) {
    if (typeof val == "function")
        return val.toSource();
    if (val instanceof Ci.nsIDOMNode || val instanceof Ci.nsIDOMWindow)
        return { DOMNode: String(val) };
    return val;
}

function test(val, params) {
    frame.events[val ? "pass" : "fail"](params);
    return val;
}

var NS = Namespace("dactyl", "http://vimperator.org/namespaces/liberator");

function assert(funcName, value, comment)
    test(value, {
        function: funcName,
        value: toJSON(value),
        comment: toJSON(comment)
    });

function assertEqual(funcName, want, got, comment)
    test(want == got, {
        function: funcName,
        want: toJSON(want), got: toJSON(got),
        comment: toJSON(comment)
    });

// vim: sw=4 ts=8 et ft=javascript:
