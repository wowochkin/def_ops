#!/usr/bin/env python3
"""Пакетная выгрузка документов «Памяти народа» с раскладкой по папкам.

Работает через настоящий браузер (Playwright, видимое окно, постоянный профиль):
проверку безопасности проходит человек, скрипт только ждёт и продолжает.
Запросы идут из той же вкладки, по одному, с паузой между ними.

Команды:
  login     открыть браузер и пройти проверку
  search    собрать записи из поиска в очередь (out/_state.sqlite)
  download  скачать листы по очереди, раскладывая по фонд/опись/дело
  probe     сохранить сырые данные одного документа для отладки разбора
  status    сводка по очереди
"""
from __future__ import annotations

import argparse
import base64
import datetime as dt
import json
import re
import sqlite3
import sys
import time
from pathlib import Path

SITE = "https://pamyat-naroda.ru/"
CDN = "https://cdn.pamyat-naroda.ru"
INDEXES = {
    "document": "/ind/pamyat/document,map/_search",  # документы и карты
    "magazine": "/ind/pamyat/magazine/_search",  # журналы боевых действий
}
DATE_FIELD = {"document": "document_date_b", "magazine": "date_from"}
VIEW_URL = SITE + "documents/view/?id={id}"
ES_WINDOW = 10_000  # дальше from+size Elasticsearch не отдаёт
PAGE_SIZE = 100
CAPTCHA_MARKERS = ("Проверка безопасности", "не робот", "captcha", "Captcha")


# ---------------------------------------------------------------- браузер

class Browser:
    def __init__(self, profile: Path, channel: str | None, delay: float):
        from playwright.sync_api import sync_playwright

        self._pw = sync_playwright().start()
        self.ctx = self._pw.chromium.launch_persistent_context(
            str(profile), headless=False, channel=channel, accept_downloads=True,
            viewport={"width": 1280, "height": 900},
        )
        self.page = self.ctx.pages[0] if self.ctx.pages else self.ctx.new_page()
        self.delay = delay
        self._last = 0.0

    def close(self) -> None:
        self.ctx.close()
        self._pw.stop()

    def _throttle(self) -> None:
        wait = self.delay - (time.monotonic() - self._last)
        if wait > 0:
            time.sleep(wait)
        self._last = time.monotonic()

    def on_site(self) -> None:
        if not self.page.url.startswith(SITE):
            self.page.goto(SITE, wait_until="domcontentloaded")

    def wait_for_human(self, reason: str) -> None:
        """Показать проверку в окне браузера и ждать, пока человек её пройдёт."""
        print(f"\n!!! {reason}")
        print("    Пройдите проверку в окне браузера и нажмите Enter здесь (q — выход).")
        try:
            self.page.goto(SITE, wait_until="domcontentloaded")
        except Exception:
            pass
        if input("> ").strip().lower() == "q":
            raise KeyboardInterrupt
        self._last = time.monotonic()

    def page_is_captcha(self) -> bool:
        try:
            text = self.page.title() + " " + self.page.inner_text("body")[:2000]
        except Exception:
            return False
        return any(m in text for m in CAPTCHA_MARKERS)

    def fetch(self, url: str, *, body: str | None = None, binary: bool = False,
              retries: int = 4) -> tuple[int, str, bytes | str]:
        """fetch() изнутри страницы сайта: те же куки и тот же браузер, что у человека."""
        self.on_site()
        for attempt in range(retries + 1):
            self._throttle()
            res = self.page.evaluate(
                """async ([url, body, binary]) => {
                    const opt = {credentials: 'include'};
                    if (body !== null) {
                        opt.method = 'POST';
                        opt.headers = {'Content-Type': 'text/plain'};
                        opt.body = body;
                    }
                    try {
                        const r = await fetch(url, opt);
                        const ct = r.headers.get('content-type') || '';
                        if (binary && !ct.includes('text/html')) {
                            const buf = new Uint8Array(await r.arrayBuffer());
                            let s = '';
                            for (let i = 0; i < buf.length; i += 0x8000)
                                s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
                            return {status: r.status, ct, data: btoa(s), b64: true};
                        }
                        return {status: r.status, ct, data: await r.text(), b64: false};
                    } catch (e) {
                        return {status: 0, ct: '', data: String(e), b64: false};
                    }
                }""",
                [url, body, binary],
            )
            status, ct = res["status"], res["ct"]
            data: bytes | str = base64.b64decode(res["data"]) if res["b64"] else res["data"]
            looks_html = "text/html" in ct or (isinstance(data, str) and data.lstrip()[:1] == "<")
            if status in (401, 403) or (status == 200 and looks_html and not url.startswith(SITE)):
                self.wait_for_human(f"Сайт запросил проверку ({status}) на {url}")
                continue
            if status == 429 or status >= 500 or status == 0:
                pause = min(300, 15 * 2 ** attempt)
                print(f"  {status or 'сеть'}: пауза {pause} с ({str(data)[:120]!r})")
                time.sleep(pause)
                continue
            return status, ct, data
        raise RuntimeError(f"не удалось получить {url}")

    def open(self, url: str) -> str:
        """Открыть страницу во вкладке, вернуть HTML; при проверке — ждать человека."""
        for _ in range(5):
            self._throttle()
            self.page.goto(url, wait_until="networkidle", timeout=90_000)
            if not self.page_is_captcha():
                return self.page.content()
            self.wait_for_human("Открылась страница проверки")
        raise RuntimeError(f"не удалось открыть {url}")


# ---------------------------------------------------------------- состояние

def db_open(out: Path) -> sqlite3.Connection:
    out.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(out / "_state.sqlite")
    con.execute("""create table if not exists rec(
        idx text, id text, src text, status text default 'new',
        files integer default 0, error text, primary key(idx, id))""")
    return con


# ---------------------------------------------------------------- поиск

def build_query(args, date_from: str | None, date_to: str | None) -> dict:
    if args.raw:
        q = json.loads(Path(args.raw).read_text(encoding="utf-8"))
        return q.get("query", q)
    must: list[dict] = []
    if args.query:
        must.append({"query_string": {"query": args.query, "default_field": args.field,
                                      "default_operator": "and"}})
    for f in ("fond", "opis", "delo"):
        if getattr(args, f):
            must.append({"match": {f: getattr(args, f)}})
    flt = []
    if date_from or date_to:
        rng = {k: v for k, v in (("gte", date_from), ("lte", date_to)) if v}
        flt.append({"range": {DATE_FIELD[args.index]: rng}})
    return {"bool": {"must": must or [{"match_all": {}}], "filter": {"bool": {"must": flt}}}}


def es(br: Browser, index: str, body: dict) -> dict:
    status, _, data = br.fetch(CDN + INDEXES[index], body=json.dumps(body, ensure_ascii=False))
    if status != 200:
        raise RuntimeError(f"поиск вернул {status}: {str(data)[:300]}")
    return json.loads(data)


def total_of(resp: dict) -> int:
    t = resp["hits"]["total"]
    return t["value"] if isinstance(t, dict) else int(t)


def split_range(a: str, b: str) -> tuple[tuple[str, str], tuple[str, str]] | None:
    da, db = dt.date.fromisoformat(a), dt.date.fromisoformat(b)
    if da >= db:
        return None
    mid = da + (db - da) // 2
    return (a, mid.isoformat()), ((mid + dt.timedelta(days=1)).isoformat(), b)


def harvest(br: Browser, con: sqlite3.Connection, args, a: str | None, b: str | None) -> int:
    query = build_query(args, a, b)
    first = es(br, args.index, {"size": 0, "query": query, "track_total_hits": True})
    total = total_of(first)
    label = f"{a or '…'} — {b or '…'}"
    if total > ES_WINDOW - PAGE_SIZE:
        halves = split_range(a, b) if a and b else None
        if halves:
            print(f"  {label}: {total} записей, больше окна поиска — делю период")
            return sum(harvest(br, con, args, *h) for h in halves)
        print(f"  {label}: {total} записей, будут взяты первые {ES_WINDOW}. "
              "Задайте --date-from/--date-to, чтобы выгрузить всё.")
    print(f"  {label}: {total} записей")
    got = 0
    for start in range(0, min(total, ES_WINDOW), PAGE_SIZE):
        size = min(PAGE_SIZE, ES_WINDOW - start)
        resp = es(br, args.index, {"from": start, "size": size, "query": query})
        hits = resp["hits"]["hits"]
        with con:
            for h in hits:
                src = dict(h.get("_source", {}), _index=h.get("_index"))
                rid = str(src.get("id") or h["_id"])
                con.execute("insert or ignore into rec(idx, id, src) values(?,?,?)",
                            (args.index, rid, json.dumps(src, ensure_ascii=False)))
        got += len(hits)
        print(f"    {got}/{total}", end="\r")
        if not hits:
            break
    print()
    return got


# ---------------------------------------------------------------- скачивание

IMG_RE = re.compile(r"""(?:https?:)?//cdn\.pamyat-naroda\.ru/imageload/[^"'\s<>)\\]+"""
                    r"""|(?<=["'(])/?imageload/[^"'\s<>)\\]+""")
IMG_PATH_RE = re.compile(r'"image_path"\s*:\s*"([^"]+)"')


def image_urls(src: dict, html: str, seen_network: list[str]) -> list[str]:
    """Все адреса листов документа: из сетевых запросов просмотрщика, из HTML и из записи."""
    found: list[str] = []
    for u in seen_network:
        found.append(u)
    for m in IMG_RE.findall(html):
        found.append(m)
    paths = IMG_PATH_RE.findall(html)
    if src.get("image_path"):
        p = src["image_path"]
        paths.extend(p if isinstance(p, list) else str(p).split(";"))
    for p in paths:
        if re.search(r"\.(jpe?g|png|tiff?|pdf)$", p.strip(), re.I):
            found.append("imageload/" + p.strip().lstrip("/"))
    out, seen = [], set()
    for u in found:
        u = u.replace("\\/", "/")
        if u.startswith("//"):
            u = "https:" + u
        elif not u.startswith("http"):
            u = CDN + "/" + u.lstrip("/")
        if u not in seen:
            seen.add(u)
            out.append(u)
    return out


def safe(s: object, limit: int = 80) -> str:
    s = re.sub(r'[\\/:*?"<>|\r\n\t]+', " ", str(s or "")).strip()
    s = re.sub(r"\s+", " ", s)
    return s[:limit].rstrip(" .") or "_"


def doc_dir(out: Path, idx: str, rid: str, src: dict) -> Path:
    date = str(src.get(DATE_FIELD[idx]) or src.get("document_date_b") or "")[:10] or "без-даты"
    name = src.get("document_name") or src.get("name") or ""
    return (out / idx / f"ф{safe(src.get('fond'))}" / f"оп{safe(src.get('opis'))}"
            / f"д{safe(src.get('delo'))}" / f"{date}_{rid}_{safe(name, 60)}")


def ext_of(url: str, ct: str) -> str:
    m = re.search(r"\.(jpe?g|png|tiff?|pdf)(?:$|\?)", url, re.I)
    if m:
        return "." + m.group(1).lower()
    return {"image/png": ".png", "application/pdf": ".pdf", "image/tiff": ".tif"}.get(
        ct.split(";")[0], ".jpg")


def collect_view(br: Browser, rid: str) -> tuple[str, list[str]]:
    seen: list[str] = []
    handler = lambda r: seen.append(r.url) if "/imageload/" in r.url else None  # noqa: E731
    br.page.on("request", handler)
    try:
        html = br.open(VIEW_URL.format(id=rid))
    finally:
        br.page.remove_listener("request", handler)
    return html, seen


def download_one(br: Browser, out: Path, idx: str, rid: str, src: dict) -> int:
    folder = doc_dir(out, idx, rid, src)
    folder.mkdir(parents=True, exist_ok=True)
    html, seen = collect_view(br, rid)
    urls = image_urls(src, html, seen)
    (folder / "meta.json").write_text(json.dumps(
        {"id": rid, "index": idx, "view": VIEW_URL.format(id=rid), "record": src, "images": urls},
        ensure_ascii=False, indent=2), encoding="utf-8")
    n = 0
    for i, url in enumerate(urls, 1):
        stem = f"л{i:04d}"
        if any(folder.glob(stem + ".*")):
            n += 1
            continue
        status, ct, data = br.fetch(url, binary=True)
        if status != 200 or isinstance(data, str):
            print(f"    лист {i}: {status} {ct}")
            continue
        tmp = folder / (stem + ".part")
        tmp.write_bytes(data)
        tmp.rename(folder / (stem + ext_of(url, ct)))
        n += 1
    if not urls:
        raise RuntimeError("листы не найдены (см. команду probe)")
    return n


# ---------------------------------------------------------------- команды

def with_browser(args, fn):
    br = Browser(Path(args.profile), args.channel, args.delay)
    try:
        return fn(br)
    except KeyboardInterrupt:
        print("\nОстановлено. Повторный запуск продолжит с того же места.")
    finally:
        br.close()


def cmd_login(args) -> None:
    def run(br: Browser):
        br.page.goto(SITE)
        input("Пройдите проверку в окне браузера, затем нажмите Enter… ")
        print("Профиль сохранён:", args.profile)
    with_browser(args, run)


def cmd_search(args) -> None:
    con = db_open(Path(args.out))

    def run(br: Browser):
        br.open(SITE + "documents/")
        n = harvest(br, con, args, args.date_from, args.date_to)
        print(f"Получено записей: {n}. В очереди всего:",
              con.execute("select count(*) from rec").fetchone()[0])
    with_browser(args, run)


def cmd_download(args) -> None:
    out = Path(args.out)
    con = db_open(out)
    where = "status in ('new','error')" if args.retry_errors else "status='new'"
    rows = con.execute(f"select idx, id, src from rec where {where} order by idx, id"
                       + (f" limit {int(args.limit)}" if args.limit else "")).fetchall()
    print(f"К скачиванию документов: {len(rows)}")

    def run(br: Browser):
        br.open(SITE + "documents/")
        for k, (idx, rid, src) in enumerate(rows, 1):
            src = json.loads(src)
            print(f"[{k}/{len(rows)}] {idx} {rid} ф{src.get('fond')}-оп{src.get('opis')}"
                  f"-д{src.get('delo')} {str(src.get('document_name', ''))[:60]}")
            try:
                n = download_one(br, out, idx, rid, src)
                with con:
                    con.execute("update rec set status='done', files=?, error=null "
                                "where idx=? and id=?", (n, idx, rid))
                print(f"    листов: {n}")
            except KeyboardInterrupt:
                raise
            except Exception as e:  # одна битая запись не останавливает выгрузку
                with con:
                    con.execute("update rec set status='error', error=? where idx=? and id=?",
                                (str(e)[:500], idx, rid))
                print(f"    ошибка: {e}")
    with_browser(args, run)


def cmd_probe(args) -> None:
    out = Path(args.out) / "_probe" / str(args.id)
    out.mkdir(parents=True, exist_ok=True)

    def run(br: Browser):
        q = {"size": 1, "query": {"ids": {"values": [str(args.id)]}}}
        try:
            (out / "record.json").write_text(
                json.dumps(es(br, args.index, q), ensure_ascii=False, indent=2), "utf-8")
        except Exception as e:
            print("Запись из поиска не получена:", e)
        net: list[str] = []
        br.page.on("request", lambda r: net.append(f"{r.method} {r.resource_type} {r.url}"))
        html = br.open(VIEW_URL.format(id=args.id))
        input("Полистайте документ в просмотрщике (несколько листов) и нажмите Enter… ")
        (out / "view.html").write_text(html, "utf-8")
        (out / "network.txt").write_text("\n".join(net), "utf-8")
        br.page.screenshot(path=str(out / "view.png"), full_page=True)
        urls = image_urls({}, html, [u.split(" ", 2)[2] for u in net if "/imageload/" in u])
        print("Найдено адресов листов:", len(urls), *urls[:5], sep="\n  ")
        print("Сырые данные:", out)
    with_browser(args, run)


def cmd_status(args) -> None:
    con = db_open(Path(args.out))
    for idx, st, n, f in con.execute(
            "select idx, status, count(*), sum(files) from rec group by idx, status"):
        print(f"{idx:9} {st:6} документов {n:7}  листов {f or 0}")
    for idx, rid, err in con.execute(
            "select idx, id, error from rec where status='error' limit 10"):
        print(f"  ошибка {idx} {rid}: {err}")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    p.add_argument("--out", default="pn-out", help="папка выгрузки (по умолчанию pn-out)")
    p.add_argument("--profile", default=".pn-profile", help="профиль браузера (куки, проверка)")
    p.add_argument("--channel", default=None, help="chrome / msedge — взять установленный браузер")
    p.add_argument("--delay", type=float, default=2.0, help="пауза между запросами, с")
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("login").set_defaults(fn=cmd_login)

    s = sub.add_parser("search", help="собрать записи в очередь")
    s.add_argument("--index", choices=INDEXES, default="document")
    s.add_argument("--query", help='текст поиска, например "62 армия"')
    s.add_argument("--field", default="document_name", help="поле для --query")
    s.add_argument("--fond"); s.add_argument("--opis"); s.add_argument("--delo")
    s.add_argument("--date-from", help="ГГГГ-ММ-ДД"); s.add_argument("--date-to", help="ГГГГ-ММ-ДД")
    s.add_argument("--raw", help="JSON-файл с готовым запросом Elasticsearch")
    s.set_defaults(fn=cmd_search)

    d = sub.add_parser("download", help="скачать листы из очереди")
    d.add_argument("--limit", type=int)
    d.add_argument("--retry-errors", action="store_true")
    d.set_defaults(fn=cmd_download)

    pr = sub.add_parser("probe", help="сырые данные одного документа")
    pr.add_argument("id")
    pr.add_argument("--index", choices=INDEXES, default="document")
    pr.set_defaults(fn=cmd_probe)

    sub.add_parser("status").set_defaults(fn=cmd_status)

    args = p.parse_args()
    if args.cmd == "search" and args.date_from and args.date_to:
        for v in (args.date_from, args.date_to):
            dt.date.fromisoformat(v)
    args.fn(args)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
