" Vim syntax file
" Language:         Melodactyl configuration file
" Maintainer:       Doug Kearns <dougkearns@gmail.com>

" TODO: make this melodactyl specific - shared dactyl config?

if exists("b:current_syntax")
  finish
endif

let s:cpo_save = &cpo
set cpo&vim

syn include @javascriptTop syntax/javascript.vim
unlet b:current_syntax

syn include @cssTop syntax/css.vim
unlet b:current_syntax

syn match melodactylCommandStart "\%(^\s*:\=\)\@<=" nextgroup=melodactylCommand,melodactylAutoCmd

syn keyword melodactylCommand run ab[breviate] abc[lear] addo[ns] au[tocmd] ba[ck] bd[elete] bw[ipeout] bun[load] tabc[lose]
    \ bma[rk] bmarks b[uffer] buffers files ls tabs ca[bbrev] cabc[lear] cd chd[ir] cm[ap] cmapc[lear] cno[remap] colo[rscheme]
    \ comc[lear] com[mand] contexts cuna[bbrev] cunm[ap] delbm[arks] delc[ommand] delmac[ros] delm[arks] delqm[arks] dels[tyle] dia[log]
    \ displayp[ane] dp[ane] dpope[n] doautoa[ll] do[autocmd] downl[oads] dl dpcl[ose] ec[ho] echoe[rr] echom[sg] el[se] elsei[f] elif
    \ em[enu] en[dif] fi exe[cute] exta[dd] extde[lete] extd[isable] exte[nable] extens[ions] exts exto[ptions] extp[references]
    \ extu[pdate] exu[sage] fini[sh] fo[rward] fw frameo[nly] ha[rdcopy] h[elp] helpa[ll] hi[ghlight] hist[ory] hs ia[bbrev] iabc[lear]
    \ if im[ap] imapc[lear] ino[remap] iuna[bbrev] iunm[ap] javas[cript] js ju[mps] keepa[lt] let loadplugins lpl macros map
    \ mapc[lear] ma[rk] marks mes[sages] messc[lear] mkm[elodactylrc] nm[ap] nmapc[lear] nno[remap] noh[lsearch] no[remap]
    \ norm[al] nunm[ap] o[pen] optionu[sage] pa[geinfo] pagest[yle] pas pm[ap] pmapc[lear] pno[remap] pref[erences] prefs punm[ap]
    \ pw[d] qma[rk] qmarks q[uit] quita[ll] qa[ll] redr[aw] re[load] reloada[ll] res[tart] runt[ime] sav[eas] w[rite]
    \ scrip[tnames] se[t] setg[lobal] setl[ocal] sil[ent] so[urce] st[op] stopa[ll] sty[le] styled[isable] styd[isable]
    \ stylee[nable] stye[nable] stylet[oggle] styt[oggle] tab taba[ttach] tabde[tach] tabd[o] bufd[o] tabdu[plicate] tabl[ast]
    \ bl[ast] tabm[ove] tabn[ext] tn[ext] bn[ext] tabo[nly] tabopen t[open] tabnew tabp[revious] tp[revious] tabN[ext] tN[ext]
    \ bp[revious] bN[ext] tabr[ewind] tabfir[st] br[ewind] bf[irst] time tm[ap] tmapc[lear] tno[remap] toolbarh[ide] tbh[ide]
    \ toolbars[how] tbs[how] toolbart[oggle] tbt[oggle] tunm[ap] una[bbreviate] unl[et] unm[ap] verb[ose] ve[rsion] vie[wsource]
    \ viu[sage] vm[ap] vmapc[lear] vno[remap] vunm[ap] wqa[ll] wq xa[ll] y[ank] zo[om]
    \ contained

syn match melodactylCommand "!" contained

syn keyword melodactylAutoCmd au[tocmd] contained nextgroup=melodactylAutoEventList skipwhite

syn keyword melodactylAutoEvent BookmarkAdd ColorScheme DOMLoad DownloadPost Fullscreen LocationChange PageLoadPre PageLoad
    \ ShellCmdPost TrackChangePre TrackChange ViewChangePre ViewChange StreamStart StreamPause StreamEnd StreamStop Enter
    \ LeavePre Leave
    \ contained

syn match melodactylAutoEventList "\(\a\+,\)*\a\+" contained contains=melodactylAutoEvent

syn region melodactylSet matchgroup=melodactylCommand start="\%(^\s*:\=\)\@<=\<\%(setl\%[ocal]\|setg\%[lobal]\|set\=\)\=\>"
    \ end="$" keepend oneline contains=melodactylOption,melodactylString

syn keyword melodactylOption activate act altwildmode awim autocomplete au cdpath cd complete cpt defsearch ds editor
    \ encoding enc eventignore ei extendedhinttags eht fileencoding fenc followhints fh guioptions go helpfile hf hintinputs hin
    \ hintkeys hk hintmatching hm hinttags ht hinttimeout hto history hi loadplugins lpl mapleader ml maxitems messages msgs
    \ newtab nextpattern pageinfo pa passkeys pk popups pps previouspattern repeat runtimepath rtp scroll scr shell sh
    \ shellcmdflag shcf showstatuslinks ssli showtabline stal suggestengines titlestring urlseparator urlsep us verbose vbs
    \ wildanchor wia wildcase wic wildignore wig wildmode wim wildsort wis wordseparators wsp
    \ contained nextgroup=melodactylSetMod

let s:toggleOptions = ["banghist", "bh", "errorbells", "eb", "exrc", "ex", "fullscreen", "fs", "hlsearch", "hls",
    \ "incsearch", "is", "insertmode", "im", "jsdebugger", "jsd", "more", "online", "searchcase", "sc", "showmode", "smd",
    \ "shuffle", "strictfocus", "sf", "usermode", "um", "visualbell", "vb"]
execute 'syn match melodactylOption "\<\%(no\|inv\)\=\%(' .
    \ join(s:toggleOptions, '\|') .
    \ '\)\>!\=" contained nextgroup=melodactylSetMod'

syn match melodactylSetMod "\%(\<[a-z_]\+\)\@<=&" contained

syn region melodactylJavaScript start="\%(^\s*\%(javascript\|js\)\s\+\)\@<=" end="$" contains=@javascriptTop keepend oneline
syn region melodactylJavaScript matchgroup=melodactylJavaScriptDelimiter
    \ start="\%(^\s*\%(javascript\|js\)\s\+\)\@<=<<\s*\z(\h\w*\)"hs=s+2 end="^\z1$" contains=@javascriptTop fold

let s:cssRegionStart = '\%(^\s*sty\%[le]!\=\s\+\%(-\%(n\|name\)\%(\s\+\|=\)\S\+\s\+\)\=[^-]\S\+\s\+\)\@<='
execute 'syn region melodactylCss start="' . s:cssRegionStart . '" end="$" contains=@cssTop keepend oneline'
execute 'syn region melodactylCss matchgroup=melodactylCssDelimiter'
    \ 'start="' . s:cssRegionStart . '<<\s*\z(\h\w*\)"hs=s+2 end="^\z1$" contains=@cssTop fold'

syn match melodactylNotation "<[0-9A-Za-z-]\+>"

syn match   melodactylComment +".*$+ contains=melodactylTodo,@Spell
syn keyword melodactylTodo FIXME NOTE TODO XXX contained

syn region melodactylString start="\z(["']\)" end="\z1" skip="\\\\\|\\\z1" oneline

syn match melodactylLineComment +^\s*".*$+ contains=melodactylTodo,@Spell

" NOTE: match vim.vim highlighting group names
hi def link melodactylAutoCmd               melodactylCommand
hi def link melodactylAutoEvent             Type
hi def link melodactylCommand               Statement
hi def link melodactylComment               Comment
hi def link melodactylJavaScriptDelimiter   Delimiter
hi def link melodactylCssDelimiter          Delimiter
hi def link melodactylNotation              Special
hi def link melodactylLineComment           Comment
hi def link melodactylOption                PreProc
hi def link melodactylSetMod                melodactylOption
hi def link melodactylString                String
hi def link melodactylTodo                  Todo

let b:current_syntax = "melodactyl"

let &cpo = s:cpo_save
unlet s:cpo_save

" vim: tw=130 et ts=4 sw=4:
