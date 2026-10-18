"""Extract only the verified frontend inputs; never extract dependency trees."""
import pathlib, re, shutil, stat, sys, zipfile

def extract(archive, destination):
    root=pathlib.Path(destination)
    root.mkdir(parents=True,exist_ok=True)
    count=0
    with zipfile.ZipFile(archive) as bundle:
        for entry in bundle.infolist():
            name=entry.filename
            parts=pathlib.PurePosixPath(name).parts
            if parts[:4] != ('Tabby.app','Contents','Resources','app.asar') and parts[:3] != ('Tabby.app','Contents','Resources'):
                continue
            relative=parts[3:]
            allowed=relative==('app.asar',) or relative[:2]==('app.asar.unpacked','dist') or (len(relative)>=4 and relative[0]=='builtin-plugins' and re.fullmatch(r'tabby-[a-z0-9-]+',relative[1]) and relative[2]=='dist')
            if not allowed or entry.is_dir():
                continue
            if '..' in parts or '\\' in name or name.startswith('/'):
                raise ValueError('Unsafe frontend path')
            if stat.S_ISLNK(entry.external_attr >> 16):
                raise ValueError('Frontend symlink forbidden')
            target=root.joinpath(*parts)
            target.parent.mkdir(parents=True,exist_ok=True)
            with bundle.open(entry) as source, target.open('wb') as output:
                shutil.copyfileobj(source,output)
            count+=1
    if not (root/'Tabby.app/Contents/Resources/app.asar').is_file():
        raise ValueError('Frontend archive missing')
    print(f'Extracted {count} whitelisted frontend inputs; dependency trees excluded')

if __name__=='__main__':
    extract(sys.argv[1],sys.argv[2])
