" Vim syntax file
" Language:         Pentadactyl configuration file
" Maintainer:       Doug Kearns <dougkearns@gmail.com>

" TODO: make this pentadactyl specific - shared dactyl config?

if exists("b:current_syntax")
  finish
endif

let s:cpo_save = &cpo
set cpo&vim

syn include @javascriptTop syntax/javascript.vim
unlet b:current_syntax

syn include @cssTop syntax/css.vim
unlet b:current_syntax

syn match pentadactylCommandStart "\%(^\s*:\=\)\@<=" nextgroup=pentadactylCommand,pentadactylAutoCmd

syn keyword pentadactylCommand run ab[breviate] abc[lear] addo[ns] au[tocmd] ba[ck] bd[elete] bw[ipeout] bun[load]
    \ tabc[lose] bma[rk] bmarks b[uffer] buffers files ls tabs ca[bbrev] cabc[lear] cd chd[ir] cm[ap] cmapc[lear] cno[remap]
    \ colo[rscheme] comc[lear] com[mand] contexts cuna[bbrev] cunm[ap] delbm[arks] delc[ommand] delmac[ros] delm[arks] delqm[arks]
    \ dels[tyle] dia[log] doautoa[ll] do[autocmd] downl[oads] dl ec[ho] echoe[rr] echom[sg] em[enu] exe[cute] exta[dd] extde[lete]
    \ extd[isable] exte[nable] extens[ions] exts exto[ptions] extp[references]  extu[pdate] exu[sage] fini[sh] fo[rward] fw
    \ frameo[nly] ha[rdcopy] h[elp] helpa[ll] hi[ghlight] hist[ory] hs ia[bbrev] iabc[lear] im[ap] imapc[lear] ino[remap]
    \ iuna[bbrev] iunm[ap] javas[cript] js ju[mps] keepa[lt] let loadplugins lpl macros map mapc[lear] ma[rk] marks mes[sages]
    \ messc[lear] mkp[entadactylrc] nm[ap] nmapc[lear] nno[remap] noh[lsearch] no[remap] norm[al] nunm[ap] o[pen] optionu[sage]
    \ pa[geinfo] pagest[yle] pas pref[erences] prefs pw[d] qma[rk] qmarks q[uit] quita[ll] qa[ll] redr[aw] re[load] reloada[ll]
    \ res[tart] runt[ime] sa[nitize] sav[eas] w[rite] sbcl[ose] scrip[tnames] se[t] setg[lobal] setl[ocal] sideb[ar] sb[ar]
    \ sbope[n] sil[ent] so[urce] st[op] stopa[ll] sty[le] styled[isable] styd[isable] stylee[nable] stye[nable] stylet[oggle]
    \ styt[oggle] tab taba[ttach] tabde[tach] tabd[o] bufd[o] tabdu[plicate] tabl[ast] bl[ast] tabm[ove] tabn[ext] tn[ext] bn[ext]
    \ tabo[nly] tabopen t[open] tabnew tabp[revious] tp[revious] tabN[ext] tN[ext] bp[revious] bN[ext] tabr[ewind] tabfir[st]
    \ br[ewind] bf[irst] time toolbarh[ide] tbh[ide] toolbars[how] tbs[how] toolbart[oggle] tbt[oggle] una[bbreviate] u[ndo]
    \ undoa[ll] unl[et] unm[ap] verb[ose] ve[rsion] vie[wsource] viu[sage] vm[ap] vmapc[lear] vno[remap] vunm[ap] winc[lose]
    \ wc[lose] wind[ow] winon[ly] wino[pen] wo[pen] wqa[ll] wq xa[ll] zo[om]
    \ contained

syn match pentadactylCommand "!" contained

syn keyword pentadactylAutoCmd au[tocmd] contained nextgroup=pentadactylAutoEventList skipwhite

syn keyword pentadactylAutoEvent BookmarkAdd BookmarkChange BookmarkRemove ColorScheme DOMLoad DownloadPost Fullscreen
    \ LocationChange PageLoadPre PageLoad PrivateMode Sanitize ShellCmdPost Enter LeavePre Leave
    \ contained

syn match pentadactylAutoEventList "\(\a\+,\)*\a\+" contained contains=pentadactylAutoEvent

syn region pentadactylSet matchgroup=pentadactylCommand start="\%(^\s*:\=\)\@<=\<\%(setl\%[ocal]\|setg\%[lobal]\|set\=\)\=\>"
    \ end="$" keepend oneline contains=pentadactylOption,pentadactylString

syn keyword pentadactylOption activate act altwildmode awim autocomplete au cdpath cd complete cpt defsearch ds editor
    \ encoding enc eventignore ei extendedhinttags eht fileencoding fenc followhints fh guioptions go helpfile hf hintinputs hin
    \ hintkeys hk hintmatching hm hinttags ht hinttimeout hto history hi laststatus ls loadplugins lpl mapleader ml maxitems
    \ messages msgs newtab nextpattern pageinfo pa popups pps previouspattern runtimepath rtp sanitizeitems si sanitizetimespan
    \ sts scroll scr shell sh shellcmdflag shcf showstatuslinks ssli showtabline stal suggestengines titlestring urlseparator us
    \ verbose vbs wildanchor wia wildcase wic wildignore wig wildmode wim wildsort wis wordseparators wsp
    \ contained nextgroup=pentadactylSetMod

let s:toggleOptions = ["banghist", "bh", "errorbells", "eb", "exrc", "ex", "flashblock", "fb", "fullscreen", "fs", "hlsearch",
    \ "hls", "ignorecase", "ic", "incsearch", "is", "insertmode", "im", "jsdebugger", "jsd", "linksearch", "lks", "more",
    \ "online", "private", "pornmode", "showmode", "smd", "smartcase", "scs", "strictfocus", "sf", "usermode", "um", "visualbell",
    \ "vb"]
execute 'syn match pentadactylOption "\<\%(no\|inv\)\=\%(' .
    \ join(s:toggleOptions, '\|') .
    \ '\)\>!\=" contained nextgroup=pentadactylSetMod'

syn match pentadactylSetMod "\%(\<[a-z_]\+\)\@<=&" contained

syn region pentadactylJavaScript start="\%(^\s*\%(javascript\|js\)\s\+\)\@<=" end="$" contains=@javascriptTop keepend oneline
syn region pentadactylJavaScript matchgroup=pentadactylJavaScriptDelimiter
    \ start="\%(^\s*\%(javascript\|js\)\s\+\)\@<=<<\s*\z(\h\w*\)"hs=s+2 end="^\z1$" contains=@javascriptTop fold

let s:cssRegionStart = '\%(^\s*sty\%[le]!\=\s\+\%(-\%(n\|name\)\%(\s\+\|=\)\S\+\s\+\)\=[^-]\S\+\s\+\)\@<='
execute 'syn region pentadactylCss start="' . s:cssRegionStart . '" end="$" contains=@cssTop keepend oneline'
execute 'syn region pentadactylCss matchgroup=pentadactylCssDelimiter'
    \ 'start="' . s:cssRegionStart . '<<\s*\z(\h\w*\)"hs=s+2 end="^\z1$" contains=@cssTop fold'

syn match pentadactylNotation "<[0-9A-Za-z-]\+>"

syn match   pentadactylComment +".*$+ contains=pentadactylTodo,@Spell
syn keyword pentadactylTodo FIXME NOTE TODO XXX contained

syn region pentadactylString start="\z(["']\)" end="\z1" skip="\\\\\|\\\z1" oneline

syn match pentadactylLineComment +^\s*".*$+ contains=pentadactylTodo,@Spell

" NOTE: match vim.vim highlighting group names
hi def link pentadactylAutoCmd               pentadactylCommand
hi def link pentadactylAutoEvent             Type
hi def link pentadactylCommand               Statement
hi def link pentadactylComment               Comment
hi def link pentadactylJavaScriptDelimiter   Delimiter
hi def link pentadactylCssDelimiter          Delimiter
hi def link pentadactylNotation              Special
hi def link pentadactylLineComment           Comment
hi def link pentadactylOption                PreProc
hi def link pentadactylSetMod                pentadactylOption
hi def link pentadactylString                String
hi def link pentadactylTodo                  Todo

let b:current_syntax = "pentadactyl"

let &cpo = s:cpo_save
unlet s:cpo_save

" vim: tw=130 et ts=4 sw=4:
