#!/usr/bin/env python3
"""Verified local SQLite backup for a running, separately deployed Compose app."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
from datetime import datetime, timezone, timedelta

NAME = re.compile(r'^logistics-\d{8}T\d{6}Z-[0-9a-f]{8}\.sqlite$')

def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()

def prune(directory, keep_days, now):
    removed = []
    for path in directory.iterdir():
        # Only this job's completed backups with matching checksum sidecars qualify.
        if path.is_symlink() or not path.is_file() or not NAME.fullmatch(path.name):
            continue
        sidecar = path.with_suffix('.sqlite.sha256')
        if not sidecar.is_file() or sidecar.is_symlink():
            continue
        age = datetime.fromtimestamp(path.stat().st_mtime, timezone.utc)
        if age >= now - timedelta(days=keep_days):
            continue
        expected = sidecar.read_text().strip()
        if expected != sha256(path):
            continue
        path.unlink()
        sidecar.unlink()
        removed.append(path.name)
    return removed

def run_backup(app_root, directory, keep_days=30):
    if not 1 <= keep_days <= 3650:
        raise ValueError('보관 기간은 1~3650일입니다.')
    app_root, directory_input = Path(app_root).resolve(), Path(directory)
    if directory_input.is_symlink():
        raise ValueError('백업 폴더에 심볼릭 링크를 사용할 수 없습니다.')
    directory = directory_input.resolve()
    if directory == app_root or directory in app_root.parents or directory in {Path('/var/backups'),Path('/tmp'),Path('/home')}:
        raise ValueError('백업 전용 하위 폴더를 지정하세요.')
    marker = directory / '.scm-logistics-backups'
    if directory.exists() and any(directory.iterdir()) and not marker.is_file():
        raise ValueError('기존 파일이 있는 폴더는 사용하지 않습니다. 빈 백업 전용 폴더를 지정하세요.')
    if not (app_root / 'compose.yaml').is_file():
        raise ValueError('프로젝트의 compose.yaml이 없습니다.')
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(directory, 0o700)
    marker.touch(mode=0o600, exist_ok=True)
    env = {k: v for k, v in os.environ.items() if k not in {'DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'}}
    compose = ['docker','--host=unix:///var/run/docker.sock','compose','--project-directory',str(app_root),'-f',str(app_root/'compose.yaml')]
    def command(args):
        result = subprocess.run(compose + args, capture_output=True, text=True, timeout=180, env=env)
        if result.returncode:
            raise RuntimeError('Docker 백업 명령 실패. 서비스 상태·디스크 공간·프로젝트 경로를 확인하세요. 기존 백업은 삭제하지 않았습니다.')
        return result.stdout.strip()
    if not command(['ps','--status','running','--quiet','logistics']):
        raise RuntimeError('실행 중인 logistics 서비스가 없습니다. 서버를 자동 생성하지 않았습니다.')
    now = datetime.now(timezone.utc)
    name = f'logistics-{now:%Y%m%dT%H%M%SZ}-{secrets.token_hex(4)}.sqlite'
    source = '/app/data/backups/' + name
    destination = directory / name
    partial = directory / (name + '.partial')
    command(['exec','-T','logistics','node','backup-db.mjs',source])
    expected = command(['exec','-T','logistics','node','-e',"const f=require('node:fs'),c=require('node:crypto');console.log(c.createHash('sha256').update(f.readFileSync(process.argv[1])).digest('hex'))",source])
    try:
        command(['cp', 'logistics:' + source, str(partial)])
        os.chmod(partial, 0o600)
        if not re.fullmatch('[0-9a-f]{64}', expected) or sha256(partial) != expected:
            raise RuntimeError('백업 체크섬이 일치하지 않습니다. 원본과 기존 백업을 보존했습니다.')
        partial.replace(destination)
        sidecar = destination.with_suffix('.sqlite.sha256')
        sidecar.write_text(expected + '\n')
        os.chmod(sidecar, 0o600)
    finally:
        partial.unlink(missing_ok=True)
    # Only remove the staging copy after a verified host backup exists.
    command(['exec','-T','logistics','node','-e',"require('node:fs').unlinkSync(process.argv[1])",source])
    removed = prune(directory, keep_days, now)
    return {'backup':str(destination),'sha256':expected,'bytes':destination.stat().st_size,'removed_old_backups':removed,'cloud_upload':False}

def main():
    parser = argparse.ArgumentParser(description='실행 중인 Compose 앱 DB를 검증 후 로컬 백업합니다. AWS 업로드는 하지 않습니다.')
    parser.add_argument('--app-root',required=True)
    parser.add_argument('--backup-dir',required=True)
    parser.add_argument('--keep-days',type=int,default=30)
    args = parser.parse_args()
    print(json.dumps(run_backup(args.app_root,args.backup_dir,args.keep_days),ensure_ascii=False))

if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, RuntimeError, subprocess.TimeoutExpired) as exc:
        print(str(exc),file=sys.stderr)
        sys.exit(1)
