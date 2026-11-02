# 일일 로컬 DB 백업

배포 서버가 정해진 뒤 활성화할 설정입니다. 현재 개발 환경에서는 타이머를 설치·활성화하지 않았습니다. AWS/S3 자원이나 사용료를 발생시키는 작업은 하지 않습니다.

## 동작

실행 중인 Docker Compose logistics 서비스의 SQLite 온라인 백업을 만들고, 호스트로 복사한 뒤 양쪽 SHA-256이 일치해야 완료 처리합니다. 파일은 600, 전용 폴더는 700 권한으로 제한합니다. 검증된 복사본이 있어야 컨테이너의 임시 백업을 지웁니다. 백업에 실패하면 기존 백업의 보관 정리를 실행하지 않습니다.

기본 보관은 30일입니다. 이 작업의 파일명 규칙과 체크섬 파일이 일치하는 완료 백업만 정리합니다. 다른 파일·손상된 파일·심볼릭 링크를 삭제하지 않습니다. 기존 사용자 파일이 있는 폴더를 임의로 백업 폴더로 바꾸지 않도록 차단합니다.

전체 DB에는 사용자 계정 해시와 세션·변경 이력도 포함됩니다. 접근 권한을 제한하세요. 로컬 백업은 같은 서버의 디스크 장애를 대비한 외부 백업을 대체하지 않으며, S3 등의 별도 보관은 호스팅·요금 선택 후 연결합니다.

## 수동 검증

프로젝트가 /opt/scm-logistics에 배치되어 있고 서비스가 실행 중인 서버에서:

```sh
sudo python3 /opt/scm-logistics/deploy/backup/run-local.py \
  --app-root /opt/scm-logistics \
  --backup-dir /var/backups/scm-logistics \
  --keep-days 30
```

이 작업은 로컬 Docker 소켓만 사용하며 서비스를 자동 생성하지 않습니다. 데이터 폴더나 데이터 볼륨은 삭제하지 않습니다.

## 예약 실행 활성화

서버의 실제 설치 경로가 다르면 service의 WorkingDirectory와 ExecStart를 먼저 수정하세요. 프로젝트·작업 스크립트는 서버 관리자만 수정할 수 있도록 관리합니다. 수동 백업 성공을 확인한 뒤:

```sh
sudo install -m 0644 deploy/backup/scm-logistics-backup.service /etc/systemd/system/
sudo install -m 0644 deploy/backup/scm-logistics-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now scm-logistics-backup.timer
sudo systemctl list-timers scm-logistics-backup.timer
```

예약은 매일 Asia/Seoul 02:30이며 최대 5분의 지연을 둡니다. 시스템이 꺼져 놓친 일정은 재시작 후 실행합니다. 같은 service가 실행 중이면 systemd가 겹쳐 실행하지 않습니다. 수동 실행을 별도로 동시에 걸지 마세요. 실패 로그는 `journalctl -u scm-logistics-backup.service`에서 확인합니다. 알림 서비스 연동은 아직 없습니다.

## 검증 결과

전용 임시 Compose 프로젝트와 임시 DB만 사용해 컨테이너 로그인·자료 저장, 컨테이너 재시작 유지, 실제 백업·체크섬 검증, 백업 파일로 컨테이너 재생성·DB 복원까지 확인했습니다. 사용자 개발 DB와 기존 운영 사이트는 변경하지 않았습니다. 자동 보관 로직은 `npm run test:backup`으로 검증하며, 타이머 시간 표현도 systemd 도구로 확인했습니다. 실제 운영 서버의 정기 실행·외부 보관은 서버 선정 후 검증해야 합니다.
