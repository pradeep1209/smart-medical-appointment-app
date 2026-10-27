import json
from pathlib import Path
from pypdf import PdfReader

root = Path('qa/shared/experience')
checks = []
for name in ['prescription', 'appointment', 'care-history', 'long-prescription']:
    reader = PdfReader(root / f'{name}.pdf')
    texts = [page.extract_text() for page in reader.pages]
    assert all(len(text.strip()) > 90 for text in texts), f'{name}: empty/spurious page'
    assert all(f'Page {index+1} of {len(texts)}' in text for index, text in enumerate(texts)), name
    if name != 'long-prescription':
        assert len(texts) == 1, name
    else:
        assert len(texts) >= 4
        assert 'END OF LONG CLINICAL TEXT' in '\n'.join(texts), 'Long text was truncated'
    checks.append({'file': f'{name}.pdf', 'pages': len(texts), 'result': 'PASS'})
(root / 'pdf-checks.json').write_text(json.dumps({'result': 'PASS', 'checks': checks}, indent=2))
print(json.dumps(checks))
