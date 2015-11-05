# Dactyl

The Dactyl project is largely about digits. Most of us have five of them on each hand. That's a total of ten fingers that we've all spent years training to operate a keyboard of 80 or more keys without any apparent thought. The Dactyl developers can't reconcile this with user interfaces which make such lax use of such a wonderful resource. We like to work efficiently; to access what we need without hunting through menus or cluttering our screen with buttons and bars; and to never have to interrupt our concentration or work flow by reaching for the mouse when we don't need to.

Towards this end, the Dactyl project reworks Gecko applications like Firefox, Thunderbird, and Songbird so that we can use them more comfortably and efficiently. We take our inspiration from Unix applications that have been satisfying power users for years, from the ample feedback of our community, and sometimes even from other add-ons for the applications that we extend. We owe a lot to the developers and users of Vim, Links, Lynx, mutt, cmus, Emacs, Conkeror, and many, many others for showing us the way. 

## Pentadactyl

How to build the extension:

1. `cd dactyl/pentadactyl`
1. `make xpi`
1. The extension will then be found in the `../downloads/` directory.

If to need to increase the max version, look in the `pentadactyl/install.rdf` file.
