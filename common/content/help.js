// Copyright (c) 2009-2010 by Kris Maglione <kris@vimperator.org>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

function checkFragment() {
    document.title = document.getElementsByTagNameNS("http://www.w3.org/1999/xhtml", "title")[0].textContent;
    var frag = document.location.hash.substr(1);
    var elem = document.getElementById(frag);
    function action() {
        window.content.scrollTo(0, window.content.scrollY + elem.getBoundingClientRect().top - 10); // 10px context
    }
    if (elem) {
        action();
        setTimeout(action, 10);
    }
}

document.addEventListener("load", checkFragment, true);
document.addEventListener("hashChange", checkFragment, true);

// vim: set fdm=marker sw=4 ts=4 et:
