#!/usr/bin/env python3
"""
HTML 파일 일괄 refactoring:
1) script 태그 정비 (jikin.js eager 제거 + eq_default.js, common.js 추가)
2) 인라인 DEFAULT_EQ 배열 제거 (eq_default.js 가 정본)
3) 인라인 SK / CRED / numToKorean / getYouTubeId / compressImage 제거 (common.js 가 정본)
4) 인라인 modal-ov 외부클릭 핸들러 제거 (common.js 자동 바인딩)

각 파일에 대해 멱등(idempotent)하게 동작 — 이미 적용된 파일은 변경 없음.
"""
import re
import sys
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

FILES = [ROOT / '공급기업_관리.html', ROOT / '신청기업_장비신청.html']

REPLACEMENTS = []  # (description, pattern, replacement, flags, expected_count)

# 1) script 태그 블록: config.js, api.js, jikin.js → 4개로 정비
SCRIPT_OLD = (
    r'<script src="config\.js"></script>\s*\n'
    r'\s*<script src="api\.js"></script>\s*\n'
    r'\s*<script src="jikin\.js"></script>'
)
SCRIPT_NEW = (
    '<script src="config.js"></script>\n'
    '<script src="eq_default.js"></script>\n'
    '<script src="common.js"></script>\n'
    '<script src="api.js"></script>'
)
REPLACEMENTS.append(('script tags', SCRIPT_OLD, SCRIPT_NEW, 0, 1))

# 2) 인라인 DEFAULT_EQ 배열 제거
#    공급기업: `// ═══...\n// DEFAULT EQUIPMENT\n// ═══...\nconst DEFAULT_EQ=[ ... ];\n`
#    신청기업: `// DEFAULT EQUIPMENT (60 items from xlsx)\n// ═══...\nconst DEFAULT_EQ = [ ... ];\n`
DEFEQ_PATTERN = (
    r'(?://[^\n]*\n)*'                          # 위 코멘트들
    r'const\s+DEFAULT_EQ\s*=\s*\[\s*\n'          # 배열 시작
    r'(?:\s*\{id:\d+[^\n]*\},?\s*\n)+'           # 60개 객체 라인들
    r'\s*\];\s*\n'                               # 배열 끝
)
DEFEQ_NEW = '// DEFAULT_EQ 는 eq_default.js 에서 로드됨 (P1-1 통합)\n'
REPLACEMENTS.append(('inline DEFAULT_EQ', DEFEQ_PATTERN, DEFEQ_NEW, re.MULTILINE, 1))

# 3) 인라인 SK 상수 제거 — common.js 가 정본
SK_OLD = r'const\s+SK\s*=\s*\{\s*EQ:\s*[\'"]bpk_eq_v2[\'"],\s*APP:\s*[\'"]bpk_app_v1[\'"],\s*QT:\s*[\'"]bpk_qt_v1[\'"]\s*\};?\s*\n'
SK_NEW = ''  # common.js 가 정의
REPLACEMENTS.append(('inline SK', SK_OLD, SK_NEW, 0, 1))

# 4) 인라인 CRED 상수 제거 (공급기업에만 존재) — common.js 가 정본
CRED_OLD = r'const\s+CRED\s*=\s*\{\s*id:\s*[\'"]bpkadmin[\'"],\s*pw:\s*[\'"]BPK2026![\'"]\s*\};[^\n]*\n'
CRED_NEW = ''
REPLACEMENTS.append(('inline CRED', CRED_OLD, CRED_NEW, 0, None))  # 0건도 OK

# 5) 인라인 numToKorean 함수 제거 — common.js 가 정본
NUM_OLD = r'function\s+numToKorean\s*\(\s*num\s*\)\s*\{[^}]*?while\s*\([^}]*?\}\s*return\s+[\'"]금[\s\S]*?원정[\'"];\s*\n?\s*\}\s*\n'
NUM_NEW = ''
REPLACEMENTS.append(('inline numToKorean', NUM_OLD, NUM_NEW, 0, 1))

# 6) 인라인 getYouTubeId 함수 제거 (공급기업에만 외부 함수로 존재) — common.js 가 정본
GYT_OLD = r'function\s+getYouTubeId\s*\(\s*url\s*\)\s*\{[^}]*?return\s+m\?m\[1\]:null;\s*\n\s*\}\s*\n'
GYT_NEW = ''
REPLACEMENTS.append(('inline getYouTubeId', GYT_OLD, GYT_NEW, 0, None))

# 7) 인라인 compressImage 함수 제거 (공급기업에만) — common.js 가 정본
CIMG_OLD = (
    r'//[^\n]*900px[^\n]*\n'
    r'function\s+compressImage\s*\(\s*dataUrl\s*\)\s*\{\s*\n'
    r'(?:\s*[^\n]*\n)+?'
    r'\s*\}\s*\n'
)
CIMG_NEW = ''
REPLACEMENTS.append(('inline compressImage', CIMG_OLD, CIMG_NEW, 0, None))

# 8) 인라인 modal-ov 외부클릭 핸들러 제거 — common.js 가 자동 바인딩
MOV_OLD = r"document\.querySelectorAll\('\.modal-ov'\)\.forEach\(el=>el\.addEventListener\('click',e=>\{if\(e\.target===el\)\s*el\.classList\.remove\('open'\);\}\)\);\s*\n"
MOV_NEW = ''
REPLACEMENTS.append(('inline modal-ov handler', MOV_OLD, MOV_NEW, 0, None))


def process(file_path: Path):
    print(f'\n=== {file_path.name} ===')
    text = file_path.read_text(encoding='utf-8')
    orig = text
    for name, pat, rep, flags, expected in REPLACEMENTS:
        new_text, n = re.subn(pat, rep, text, flags=flags)
        if n == 0 and expected and expected > 0:
            print(f'  ! {name}: 0건 (이미 적용됨 또는 패턴 불일치)')
        else:
            print(f'  ✓ {name}: {n}건 치환')
        text = new_text
    if text == orig:
        print('  → 변경 없음 (이미 모두 적용됨)')
        return False
    file_path.write_text(text, encoding='utf-8')
    print(f'  → 저장 ({len(orig)} → {len(text)} bytes, Δ={len(text)-len(orig):+d})')
    return True


if __name__ == '__main__':
    for f in FILES:
        if not f.exists():
            print(f'! {f} 없음 — 건너뜀')
            continue
        process(f)
    print('\n완료.')
