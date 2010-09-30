VIMBALL = teledactyl.vba

vimball: mkvimball.txt syntax/teledactyl.vim ftdetect/teledactyl.vim
	-echo '%MkVimball! ${VIMBALL} .' | vim -u NORC -N -e -s mkvimball.txt

all: vimball

clean:
	rm -f ${VIMBALL}
