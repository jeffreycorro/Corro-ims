-- CorConDev HR — status + contribution patches, 2026-09-16
-- NEVER DELETE. Match on data->>'empNo'. Update every matching row
-- (empNo 1351 Pasion, Ben has two rows; both must become Separated).
--
-- Paste in the Supabase SQL editor of the project used by corcondev-hr.

begin;

-- Separated roster (unique empNo). Empty dates/reasons stay unchanged.
with roster(emp_no, separated_on, separation_reason) as (
  values
    ('1243', null, null),
    ('1248', '2026-08-31', 'Not on the 2026-08-31 manpower report; confirmed by HR'),
    ('1249', '2026-08-31', 'Not on the 2026-08-31 manpower report; confirmed by HR'),
    ('1255', null, null),
    ('1258', null, null),
    ('1260', '2026-08-31', 'Not on the 2026-08-31 manpower report; confirmed by HR'),
    ('1261', '2026-08-31', 'Not on the 2026-08-31 manpower report; confirmed by HR'),
    ('1262', null, null),
    ('1263', '2026-08-31', 'Not on the 2026-08-31 manpower report; confirmed by HR'),
    ('1264', '2026-08-31', 'Not on the 2026-08-31 manpower report; confirmed by HR'),
    ('1265', null, null),
    ('1267', '2026-08-31', 'Not on the 2026-08-31 manpower report; confirmed by HR'),
    ('1270', null, null),
    ('1274', null, null),
    ('1275', '2026-08-31', 'Not on the 2026-08-31 manpower report; confirmed by HR'),
    ('1279', '2026-08-31', 'Not on the 2026-08-31 manpower report; confirmed by HR'),
    ('1281', null, null),
    ('1283', '2026-08-31', 'Not on the 2026-08-31 manpower report; confirmed by HR'),
    ('1285', '2026-08-31', 'Not on the 2026-08-31 manpower report; confirmed by HR'),
    ('1286', '2026-08-31', 'Not on the 2026-08-31 manpower report; confirmed by HR'),
    ('1289', null, null),
    ('1292', '2026-08-31', 'Not on the 2026-08-31 manpower report; confirmed by HR'),
    ('1293', '2026-08-31', 'Not on the 2026-08-31 manpower report; confirmed by HR'),
    ('1294', '2026-08-31', 'Not on the 2026-08-31 manpower report; confirmed by HR'),
    ('1295', '2026-08-31', 'Not on the 2026-08-31 manpower report; confirmed by HR'),
    ('1296', null, null),
    ('1300', '2026-08-31', 'Not on the 2026-08-31 manpower report; confirmed by HR'),
    ('1301', '2026-08-31', 'Not on the 2026-08-31 manpower report; confirmed by HR'),
    ('1302', '2026-08-31', 'Not on the 2026-08-31 manpower report; confirmed by HR'),
    ('1303', null, null),
    ('1304', '2026-08-31', 'Not on the 2026-08-31 manpower report; confirmed by HR'),
    ('1305', '2026-08-31', 'Not on the 2026-08-31 manpower report; confirmed by HR'),
    ('1306', '2026-08-31', 'Not on the 2026-08-31 manpower report; confirmed by HR'),
    ('1307', '2026-08-31', 'Not on the 2026-08-31 manpower report; confirmed by HR'),
    ('1308', null, null),
    ('1309', null, null),
    ('1311', null, null),
    ('1312', null, null),
    ('1313', null, null),
    ('1314', '2026-08-31', 'Not on the 2026-08-31 manpower report; confirmed by HR'),
    ('1315', null, null),
    ('1317', '2026-08-31', 'Not on the 2026-08-31 manpower report; confirmed by HR'),
    ('1318', null, null),
    ('1319', '2026-08-31', 'Not on the 2026-08-31 manpower report; confirmed by HR'),
    ('1321', '2026-08-31', 'Not on the 2026-08-31 manpower report; confirmed by HR'),
    ('1322', '2026-08-31', 'Not on the 2026-08-31 manpower report; confirmed by HR'),
    ('1324', '2026-08-31', 'Not on the 2026-08-31 manpower report; confirmed by HR'),
    ('1325', '2026-08-31', 'Not on the 2026-08-31 manpower report; confirmed by HR'),
    ('1326', '2026-08-31', 'Not on the 2026-08-31 manpower report; confirmed by HR'),
    ('1327', '2026-08-31', 'Not on the 2026-08-31 manpower report; confirmed by HR'),
    ('1328', '2026-08-31', 'Not on the 2026-08-31 manpower report; confirmed by HR'),
    ('1329', '2026-08-31', 'Not on the 2026-08-31 manpower report; confirmed by HR'),
    ('1331', '2026-08-31', 'Not on the 2026-08-31 manpower report; confirmed by HR'),
    ('1332', '2026-08-31', 'Not on the 2026-08-31 manpower report; confirmed by HR'),
    ('1333', '2026-08-31', 'Not on the 2026-08-31 manpower report; confirmed by HR'),
    ('1335', '2026-08-31', 'Not on the 2026-08-31 manpower report; confirmed by HR'),
    ('1336', '2026-08-31', 'Not on the 2026-08-31 manpower report; confirmed by HR'),
    ('1337', '2026-08-31', 'Not on the 2026-08-31 manpower report; confirmed by HR'),
    ('1338', '2026-08-31', 'Not on the 2026-08-31 manpower report; confirmed by HR'),
    ('1339', '2026-08-31', 'Not on the 2026-08-31 manpower report; confirmed by HR'),
    ('1340', '2026-08-31', 'Not on the 2026-08-31 manpower report; confirmed by HR'),
    ('1341', '2026-08-31', 'Not on the 2026-08-31 manpower report; confirmed by HR'),
    ('1344', '2026-08-31', 'Not on the 2026-08-31 manpower report; confirmed by HR'),
    ('1345', '2026-08-31', 'Not on the 2026-08-31 manpower report; confirmed by HR'),
    ('1347', '2026-08-31', 'Not on the 2026-08-31 manpower report; confirmed by HR'),
    ('1351', '2026-09-02', 'Duplicate record, confirmed 2026-09-02 — there are TWO 1351 Pasion rows and both are separated')
)
update public.docs d
set data = d.data
  || jsonb_build_object('status', 'Separated')
  || case
       when r.separated_on is null then '{}'::jsonb
       else jsonb_build_object('separatedOn', r.separated_on)
     end
  || case
       when r.separation_reason is null then '{}'::jsonb
       else jsonb_build_object('separationReason', r.separation_reason)
     end
from roster r
where d.collection = 'employees'
  and (d.data->>'empNo') = r.emp_no;

-- Per-head statutory deductions. Explicit zeros must be stored.
with contrib(emp_no, sss, phic, hdmf) as (
  values
    ('1242', 0::numeric, 0::numeric, 0::numeric),
    ('1244', 0, 0, 0),
    ('1245', 325, 0, 100),
    ('1246', 0, 0, 0),
    ('1247', 0, 0, 0),
    ('1250', 0, 0, 0),
    ('1251', 325, 131.25, 0),
    ('1252', 325, 131.25, 0),
    ('1253', 0, 0, 0),
    ('1254', 325, 131.25, 100),
    ('1259', 325, 0, 0),
    ('1266', 325, 131.25, 100),
    ('1271', 325, 0, 100),
    ('1272', 0, 0, 0),
    ('1273', 0, 0, 0),
    ('1276', 325, 0, 0),
    ('1278', 0, 0, 0),
    ('1280', 0, 0, 0),
    ('1287', 0, 0, 0),
    ('1288', 325, 131.25, 100),
    ('1290', 325, 131.25, 100),
    ('1297', 0, 0, 0),
    ('1298', 325, 0, 100),
    ('1299', 0, 0, 0),
    ('1330', 0, 0, 0),
    ('1334', 0, 0, 0),
    ('1348', 0, 0, 0),
    ('1349', 0, 0, 0),
    ('1350', 0, 0, 0),
    ('1351', 0, 0, 0),
    ('1352', 0, 0, 0),
    ('1355', 0, 0, 0),
    ('1358', 0, 0, 0)
)
update public.docs d
set data = d.data || jsonb_build_object(
  'ded', jsonb_build_object('sss', c.sss, 'phic', c.phic, 'hdmf', c.hdmf)
)
from contrib c
where d.collection = 'employees'
  and (d.data->>'empNo') = c.emp_no;

commit;

-- Sanity (read-only):
-- select count(*) from public.docs
--   where collection = 'employees' and data->>'status' = 'Separated'
--     and data->>'empNo' in (select emp_no from roster);
-- select id, data->>'empNo', data->>'name', data->>'status'
--   from public.docs
--   where collection = 'employees' and data->>'empNo' = '1351';
