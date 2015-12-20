"use strict";
var INFO =
["plugin", { name: "curl",
             version: "0.3",
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
    if (elem.form)
        var { url, postData, elements } = DOM(elem).formData;
    else
        var url = elem.getAttribute("href");

    if (!url || /^javascript:/.test(url))
        return;

    url = util.newURI(url, null,
                      elem.ownerDocument.documentURIObject).spec;

    let { shellEscape } = util.closure;

    dactyl.clipboardWrite(["curl"].concat(
        [].concat(
            [["--form-string", shellEscape(datum)] for (datum of (elements || []))],
            postData != null && !elements.length ? [["-d", shellEscape("")]] : [],
            [["-H", shellEscape("Cookie: " + elem.ownerDocument.cookie)],
             ["-A", shellEscape(navigator.userAgent)],
             [shellEscape(url)]]
        ).map(function(e) e.join(" ")).join(" \\\n     ")).join(" "), true);
});

/* vim:se sts=4 sw=4 et: */
