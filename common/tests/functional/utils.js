function module(uri) {
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
    else
        return val;
}

function test(val, params) {
    frame.events[val ? "pass" : "fail"](params);
    return val;
}

for (var [k, v] in Iterator({

    NS: Namespace("dactyl", "http://vimperator.org/namespaces/liberator"),

    module: module,

    toJSON: toJSON,

    test: test,

    assert: function (funcName, value, comment)
        test(value, {
            function: funcName,
            value: toJSON(value),
            comment: toJSON(comment)
        }),

    assertEqual: function (funcName, want, got, comment)
        test(want == got, {
            function: funcName,
            want: toJSON(want), got: toJSON(got),
            comment: toJSON(comment)
        })
}))
    exports[k] = v;

// vim: sw=4 ts=8 et:
