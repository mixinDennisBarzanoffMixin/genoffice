use std::{io::{BufRead, BufReader, Cursor, Write}, process::{Child, Command, Stdio}, sync::mpsc, time::Duration};

struct Process(Child);
impl Drop for Process {
    fn drop(&mut self) { let _ = self.0.kill(); let _ = self.0.wait(); }
}

#[test]
fn importer_features_never_write_outside_the_json_line_protocol() {
    let source = include_bytes!("../../../tests/fixtures/representative.xlsx");
    let mut archive = zip::ZipArchive::new(Cursor::new(source)).unwrap();
    let mut output = zip::ZipWriter::new(Cursor::new(Vec::new()));
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).unwrap();
        if matches!(entry.name(), "xl/styles.xml" | "xl/worksheets/sheet1.xml") {
            use std::io::Read;
            let mut body = String::new();entry.read_to_string(&mut body).unwrap();
            if entry.name() == "xl/styles.xml" {
                body = body.replace("<font/>", "<font><vertAlign val=\"superscript\"/><color/></font>");
            } else {
                body = body.replace("<row r=\"1\" spans=\"1:4\">", "<row r=\"1\" spans=\"1:4\"><c r=\"B1\" t=\"d\"><v>2026-01-01</v></c><c r=\"D1\" t=\"unknown\"><v>0</v></c>");
            }
            output.start_file(entry.name(), zip::write::SimpleFileOptions::default()).unwrap();
            output.write_all(body.as_bytes()).unwrap();
        } else { output.raw_copy_file(entry).unwrap(); }
    }
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("protocol.xlsx");
    std::fs::write(&path, output.finish().unwrap().into_inner()).unwrap();
    let mut process = Process(Command::new(env!("CARGO_BIN_EXE_xlsx-sidecar"))
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().unwrap());
    let stdout = process.0.stdout.take().unwrap();
    let (send, receive) = mpsc::channel();
    let reader = std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() { if send.send(line).is_err() { break } }
    });
    for id in ["1", "2"] {
        let request = serde_json::json!({"version":1,"requestId":id,"command":"recalc_cells","path":path,"edits":[{"sheet":"Data","row":0,"column":0,"input":"8"}],"reads":[{"sheet":"Data","range":{"startRow":1,"endRow":1,"startColumn":3,"endColumn":3}}]});
        writeln!(process.0.stdin.as_mut().unwrap(), "{request}").unwrap();
        process.0.stdin.as_mut().unwrap().flush().unwrap();
        let line = receive.recv_timeout(Duration::from_secs(5)).unwrap().unwrap();
        let result: serde_json::Value = serde_json::from_str(&line).expect("one JSON protocol frame, no importer prints");
        assert_eq!(result["requestId"], id);
        assert_eq!(result["ok"], true);
        assert_eq!(result["result"]["cells"][0]["value"], serde_json::json!({"kind":"number","value":10.0}));
    }
    drop(process);
    reader.join().unwrap();
}
