#!/usr/bin/env python3
"""Read-only Lightsail plan discovery. Never provisions or changes AWS resources."""
import argparse
import json
import shutil
import subprocess
import sys
from datetime import datetime, timezone

REGION = 'ap-northeast-2'

def summarize_bundles(bundles):
    candidates = []
    for bundle in bundles:
        if not bundle.get('isActive', False):
            continue
        if 'LINUX_UNIX' not in bundle.get('supportedPlatforms', []):
            continue
        ram = float(bundle.get('ramSizeInGb', 0))
        price = bundle.get('price')
        # Show small plans, including IPv6-only options without implying public IPv4.
        if not 1 <= ram <= 4 or not isinstance(price, (int, float)):
            continue
        candidates.append({
            'bundle_id': bundle['bundleId'],
            'ram_gb': ram,
            'vcpus': bundle.get('cpuCount'),
            'disk_gb': bundle.get('diskSizeInGb'),
            'monthly_bundle_usd': price,
            'public_ipv4_count': bundle.get('publicIpv4AddressCount'),
        })
    return sorted(candidates, key=lambda row: (row['monthly_bundle_usd'], row['bundle_id']))

def aws_read(region, service, operation):
    if (service, operation) not in {('sts', 'get-caller-identity'), ('lightsail', 'get-bundles')}:
        raise ValueError('This tool permits only identity and plan-price reads.')
    result = subprocess.run(
        ['aws', '--region', region, '--output', 'json', '--no-cli-pager', service, operation],
        capture_output=True, text=True, timeout=60,
    )
    if result.returncode:
        # Credential/provider diagnostics can contain sensitive material: do not echo stderr.
        raise RuntimeError(f'{service} {operation} 조회 실패. AWS 연결·권한·허용 도메인을 확인하세요. 변경 요청은 실행하지 않았습니다.')
    return json.loads(result.stdout)

def main():
    parser = argparse.ArgumentParser(description='AWS 자원을 만들지 않고 Lightsail 공개 요금제만 조회합니다.')
    parser.add_argument('--region', default=REGION)
    args = parser.parse_args()
    if not shutil.which('aws'):
        raise RuntimeError('AWS CLI v2가 없습니다. AWS 연결이 준비된 CLI 환경에서 실행하세요. 서버 생성은 수행하지 않습니다.')
    aws_read(args.region, 'sts', 'get-caller-identity')
    result = aws_read(args.region, 'lightsail', 'get-bundles')
    print(json.dumps({
        'read_only': True,
        'region': args.region,
        'observed_at': datetime.now(timezone.utc).isoformat(),
        'plans': summarize_bundles(result.get('bundles', [])),
        'note': 'AWS 응답의 번들 월요금(USD)이며 최종 청구액이 아닙니다. S3·스냅샷·추가 전송량·도메인·세금·환율·크레딧을 별도 확인해야 합니다. 어떤 자원도 생성하지 않았습니다.',
    }, ensure_ascii=False, indent=2))

if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, ValueError, subprocess.TimeoutExpired) as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
