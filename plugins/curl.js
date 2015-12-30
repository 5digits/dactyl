"use strict";
var INFO =
["plugin", { name: "curl",
             version: "0.4",
             href: "http://dactyl.sf.net/pentadactyl/plugins#curl-plugin",
             summary: "Curl command-line generator",
             xmlns: "dactyl" },
    ["author", { email: "maglione.k@gmail.com" },
        "Kris Maglione"],
    ["license", { href: "http://opensource.org/licenses/mit-license.php" },
        "MIT"],
    ["project", { name: "Pentadactyl", "min-version": "1.0" }],
    ["p", {},
        "This plugin provides a means to generate a ", ["tt", {}, "curl(1)"], " ",
        "command-line from the data in a given form."],
    ["item", {},
        ["tags", {}, ";C"],
        ["strut"],
        ["spec", {}, ";C"],
        ["description", {},
            ["p", {},
                "Generates a curl command-line from the data in the selected form. ",
                "The command includes the data from each form element, along with ",
                "the current User-Agent string and the cookies for the current ",
                "page."]]]];

hints.addMode('C', "Generate curl command for a form", function(elem) {
    let doc = elem.ownerDocument;
    let win = doc.defaultView;

    if (elem.form)
        var { url, postData, elements } = DOM(elem).formData;
    else
        var url = elem.getAttribute("href");

    if (!url || /^javascript:/.test(url))
        return;

    url = util.newURI(url, null, doc.documentURIObject).spec;

    if (!elements)
        elements = [];

    let paramLines = [
        ...elements.map(datum => ["--form-string", datum]),

        ["-H", "Cookie: " + doc.cookie],

        ["-A", win.navigator.userAgent],

        [url],
    ];

    if (postData != null && !elements.length)
        paramLines.unshift(["-d", postData]);


    let { shellEscape } = util.bound;
    let params = paramLines.map(params => params.map(shellEscape).join(" "))
                           .join(" \\\n     ");


    dactyl.clipboardWrite(`curl ${params}`, true);
});

/* vim:se sts=4 sw=4 et: */
