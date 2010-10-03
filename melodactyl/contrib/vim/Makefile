VIMBALL = melodactyl.vba

vimball: mkvimball.txt syntax/melodactyl.vim ftdetect/melodactyl.vim
	-echo '%MkVimball! ${VIMBALL} .' | vim -u NORC -N -e -s mkvimball.txt

all: vimball

clean:
	rm -f ${VIMBALL}
