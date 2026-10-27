"""Copy only CareSlot's debug database for QA assertions after stopping its process."""
from pathlib import Path
import json
import sqlite3
import subprocess
import sys

root=Path(__file__).resolve().parents[1]
out=(root/sys.argv[1]).resolve()
if not out.is_relative_to(root/'qa'):
    raise ValueError('QA export must remain under this workspace qa directory')
out.mkdir(parents=True,exist_ok=True)
adb=[r'C:\Users\USER\AppData\Local\Android\Sdk\platform-tools\adb.exe','-s','10BD770XGP0003B']
subprocess.run(adb+['shell','am','force-stop','com.careslot.app'],check=True,capture_output=True)
for name in ['care-clinic.db','care-clinic.db-wal','care-clinic.db-shm']:
    result=subprocess.run(adb+['exec-out','run-as','com.careslot.app','cat','databases/'+name],capture_output=True)
    if result.returncode==0:
        (out/name).write_bytes(result.stdout)
    elif name.endswith('.db'):
        raise RuntimeError(result.stderr.decode(errors='replace'))
connection=sqlite3.connect((out/'care-clinic.db').as_uri()+'?mode=ro',uri=True)
connection.row_factory=sqlite3.Row
tables=['patients','doctors','appointments','prescriptions','refill_requests','appointment_events','blocked_periods','metadata']
snapshot={name:[dict(row) for row in connection.execute('SELECT * FROM '+name)] for name in tables}
connection.close()
(out/'state.json').write_text(json.dumps(snapshot,indent=2)+'\n',encoding='utf-8')
print(json.dumps({table:len(rows) for table,rows in snapshot.items()}))
