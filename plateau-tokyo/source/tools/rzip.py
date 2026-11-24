"""Read members of a remote zip over HTTP range requests (no full download).
usage: rzip.py list URL > listing.tsv
       rzip.py get URL OUTDIR PATTERN...   (fnmatch patterns against member names)"""
import sys, zipfile, io, fnmatch, os, urllib.request

class HttpFile(io.RawIOBase):
    def __init__(self, url):
        self.url = url; self.pos = 0
        req = urllib.request.Request(url, method='HEAD')
        self.size = int(urllib.request.urlopen(req).headers['Content-Length'])
        self.cache = {}
    def seekable(self): return True
    def readable(self): return True
    def tell(self): return self.pos
    def seek(self, off, whence=0):
        self.pos = off if whence == 0 else (self.pos + off if whence == 1 else self.size + off)
        return self.pos
    def read(self, n=-1):
        if n < 0: n = self.size - self.pos
        if n == 0 or self.pos >= self.size: return b''
        end = min(self.pos + n, self.size) - 1
        # read-ahead for small reads to cut request count
        fetch_end = min(max(end, self.pos + 1_048_576 - 1), self.size - 1)
        key = (self.pos, fetch_end)
        for (a, b), data in self.cache.items():
            if a <= self.pos and end <= b:
                out = data[self.pos - a:end - a + 1]; self.pos = end + 1; return out
        req = urllib.request.Request(self.url, headers={'Range': f'bytes={self.pos}-{fetch_end}'})
        data = urllib.request.urlopen(req).read()
        self.cache = {key: data}
        out = data[:end - self.pos + 1]; self.pos = end + 1; return out
    def readinto(self, b):
        d = self.read(len(b)); b[:len(d)] = d; return len(d)

def open_zip(url):
    return zipfile.ZipFile(io.BufferedReader(HttpFile(url), buffer_size=1 << 20))

if __name__ == '__main__':
    cmd, url = sys.argv[1], sys.argv[2]
    z = open_zip(url)
    if cmd == 'list':
        for i in z.infolist():
            sys.stdout.buffer.write(f'{i.compress_size}\t{i.file_size}\t{i.filename}\n'.encode('utf-8'))
    elif cmd == 'get':
        out, pats = sys.argv[3], sys.argv[4:]
        for i in z.infolist():
            if any(fnmatch.fnmatch(i.filename, p) for p in pats) and not i.is_dir():
                dst = os.path.join(out, i.filename)
                if os.path.exists(dst) and os.path.getsize(dst) == i.file_size: continue
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                with z.open(i) as src, open(dst, 'wb') as f:
                    while chunk := src.read(1 << 22): f.write(chunk)
                print(i.file_size, i.filename, flush=True)
