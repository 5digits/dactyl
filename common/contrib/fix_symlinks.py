from mercurial import util
import os

def fix_symlinks(ui, repo, hooktype, parent1, **kwargs):
    revert = hooktype in ('precommit', 'preupdate')
    ctxt = repo[parent1]
    for filename in ctxt:
        file = ctxt[filename]
        if 'l' in file.flags():
            path = repo.wjoin(file.path())
            try:
                os.unlink(path)
            except Exception, e:
                print repr(e)
            if revert:
                repo.wwrite(file.path(), file.data(), '')
            else:
                target = os.path.join(os.path.dirname(path), file.data())
                util.copyfiles(target, path, True)

