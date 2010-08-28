VIMBALL = pentadactyl.vba

vimball: mkvimball.txt syntax/pentadactyl.vim ftdetect/pentadactyl.vim
	-echo '%MkVimball! ${VIMBALL} .' | vim -u NORC -N -e -s mkvimball.txt

all: vimball

clean:
	rm -f ${VIMBALL}
