" Vim syntax file
" Language:         Teledactyl configuration file
" Maintainer:       Doug Kearns <dougkearns@gmail.com>

" TODO: make this teledactyl specific - shared dactyl config?

if exists("b:current_syntax")
  finish
endif

let s:cpo_save = &cpo
set cpo&vim

syn include @javascriptTop syntax/javascript.vim
unlet b:current_syntax

syn include @cssTop syntax/css.vim
unlet b:current_syntax

syn match teledactylCommandStart "\%(^\s*:\=\)\@<=" nextgroup=teledactylCommand,teledactylAutoCmd

syn keyword teledactylCommand ab[breviate] ab[clear] addo[ns] addr[essbook] bN[ext] bd[elete] beep bf[irst] bl[ast] bn[ext]
    \ bp[revious] br[ewind] bufd[o] bun[load] bw[ipeout] ca[bbrev] cabc[lear] cd chd[ir] cm[ap] cmapc[lear] cno[remap]
    \ colo[rscheme] com[mand] comc[lear] contexts con[tact] contacts copy[to] cu[nmap] cuna[bbrev] delc[ommand] delm[arks]
    \ delmac[ros] dels[tyle] dia[log] do[autocmd] doautoa[ll] ec[ho] echoe[rr] echom[sg] em[enu] empty[trash] exe[cute] exta[dd]
    \ extd[isable] extde[lete] exte[nable] extens[ions] exto[ptions] extp[references] exts exu[sage] fini[sh] frameo[nly]
    \ get[messages] go[to] h[elp] helpa[ll] ha[rdcopy] hi[ghlight] ia[bbrev] iabc[lear] im[ap] imapc[lear] ino[remap] iu[nmap]
    \ iuna[bbrev] javas[cript] js keepa[lt] let loadplugins lpl m[ail] ma[rk] macros map mapc[lear] marks mes[sages] messc[lear]
    \ mkt[eledactylrc] mm[ap] mmapc[lear] mno[remap] move[to] mu[nmap] nm[ap] nmapc[lear] nno[remap] noh[lsearch] no[remap]
    \ norm[al] nu[nmap] optionu[sage] pa[geinfo] pagest[yle] pas pref[erences] prefs pw[d] q[uit] re[load] res[tart] run
    \ runt[ime] sav[eas] scrip[tnames] se[t] setg[lobal] setl[ocal] sil[ent] so[urce] st[op] sty[le] styd[isable]
    \ styled[isable] stye[nable] stylee[nable] styt[oggle] stylet[oggle] tN[ext] t[open] tab tabN[ext] tabc[lose] tabd[o]
    \ tabfir[st] tabl[ast] tabn[ext] tabp[revious] tabr[ewind] tbh[ide] tbs[how] tbt[oggle] time tn[ext] toolbarh[ide]
    \ toolbars[how] toolbart[oggle] tp[revious] una[bbreviate] unl[et] unm[ap] verb[ose] ve[rsion] vie[wsource] viu[sage] vm[ap]
    \ vmapc[lear] vno[remap] vu[nmap] w[rite] zo[om]
    \ contained

syn match teledactylCommand "!" contained

syn keyword teledactylAutoCmd au[tocmd] contained nextgroup=teledactylAutoEventList skipwhite
syn keyword teledactylAutoEvent DOMLoad FolderLoad PageLoadPre PageLoad Enter Leave LeavePre contained

syn match teledactylAutoEventList "\(\a\+,\)*\a\+" contained contains=teledactylAutoEvent

syn region teledactylSet matchgroup=teledactylCommand start="\%(^\s*:\=\)\@<=\<\%(setl\%[ocal]\|setg\%[lobal]\|set\=\)\=\>"
    \ end="$" keepend oneline contains=teledactylOption,teledactylString

syn keyword teledactylOption altwildmode awim archivefolder autocomplete au banghist bh cdpath cd complete cpt editor
    \ eventignore ei extendedhinttags eht fileencoding fenc followhints fh guioptions go helpfile hf hintinputs hin hintkeys hk
    \ hintmatching hm hinttags ht hinttimeout hto history hi laststatus ls layout maxitems messages msgs nextpattern pageinfo pa
    \ previouspattern runtimepath rtp scroll scr shell sh shellcmdflag shcf showstatuslinks ssli showtabline stal smtpserver smtp
    \ suggestengines titlestring urlseparator verbose vbs wildanchor wia wildcase wic wildignore wig wildmode wim wildoptions wop
    \ wildsort wis wordseparators wsp
    \ contained nextgroup=teledactylSetMod

" toggle options
syn match teledactylOption "\<\%(no\|inv\)\=\%(autoexternal\|errorbells\|eb\|exrc\|ex\|focuscontent\|fc\|fullscreen\|fs\)\>!\="
    \ contained nextgroup=teledactylSetMod
syn match teledactylOption "\<\%(no\|inv\)\=\%(hlsearch\|hls\|ignorecase\|ic\|incsearch\|is\|insertmode\|im\)\>!\="
    \ contained nextgroup=teledactylSetMod
syn match teledactylOption "\<\%(no\|inv\)\=\%(jsdebugger\|jsd\|linksearch\|lks\|loadplugins\|lpl\|more\|online\)\>!\="
    \ contained nextgroup=teledactylSetMod
syn match teledactylOption "\<\%(no\|inv\)\=\%(showmode\|smd\|smartcase\|scs\|strictfocus\|sf\|usermode\|um\)\>!\="
    \ contained nextgroup=teledactylSetMod
syn match teledactylOption "\<\%(no\|inv\)\=\%(visualbell\|vb\)\>!\="
    \ contained nextgroup=teledactylSetMod

syn match teledactylSetMod "\%(\<[a-z_]\+\)\@<=&" contained

syn region teledactylJavaScript start="\%(^\s*\%(javascript\|js\)\s\+\)\@<=" end="$" contains=@javascriptTop keepend oneline
syn region teledactylJavaScript matchgroup=teledactylJavaScriptDelimiter
    \ start="\%(^\s*\%(javascript\|js\)\s\+\)\@<=<<\s*\z(\h\w*\)"hs=s+2 end="^\z1$" contains=@javascriptTop fold

let s:cssRegionStart = '\%(^\s*sty\%[le]!\=\s\+\%(-\%(n\|name\)\%(\s\+\|=\)\S\+\s\+\)\=[^-]\S\+\s\+\)\@<='
execute 'syn region teledactylCss start="' . s:cssRegionStart . '" end="$" contains=@cssTop keepend oneline'
execute 'syn region teledactylCss matchgroup=teledactylCssDelimiter'
    \ 'start="' . s:cssRegionStart . '<<\s*\z(\h\w*\)"hs=s+2 end="^\z1$" contains=@cssTop fold'

syn match teledactylNotation "<[0-9A-Za-z-]\+>"

syn match   teledactylComment +".*$+ contains=teledactylTodo,@Spell
syn keyword teledactylTodo FIXME NOTE TODO XXX contained

syn region teledactylString start="\z(["']\)" end="\z1" skip="\\\\\|\\\z1" oneline

syn match teledactylLineComment +^\s*".*$+ contains=teledactylTodo,@Spell

" NOTE: match vim.vim highlighting group names
hi def link teledactylAutoCmd             teledactylCommand
hi def link teledactylAutoEvent           Type
hi def link teledactylCommand             Statement
hi def link teledactylComment             Comment
hi def link teledactylJavaScriptDelimiter Delimiter
hi def link teledactylCssDelimiter        Delimiter
hi def link teledactylNotation            Special
hi def link teledactylLineComment         Comment
hi def link teledactylOption              PreProc
hi def link teledactylSetMod              teledactylOption
hi def link teledactylString              String
hi def link teledactylTodo                Todo

let b:current_syntax = "teledactyl"

let &cpo = s:cpo_save
unlet s:cpo_save

" vim: tw=130 et ts=4 sw=4:
