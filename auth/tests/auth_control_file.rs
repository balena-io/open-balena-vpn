/*
    Copyright (C) 2026 Balena Ltd.

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published
    by the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::mpsc;
use std::thread;

// Starts a stub of the vpn api that handles a single request by calling `before_response` with the
// request body once it has been read and then responding with `status`, returning the port it
// listens on
fn stub_api(status: u16, before_response: impl FnOnce(Vec<u8>) + Send + 'static) -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    thread::spawn(move || {
        let (stream, _) = listener.accept().unwrap();
        let mut reader = BufReader::new(stream);
        let mut content_length = 0;
        loop {
            let mut line = String::new();
            reader.read_line(&mut line).unwrap();
            if line == "\r\n" {
                break;
            }
            if let Some((name, value)) = line.split_once(':') {
                if name.eq_ignore_ascii_case("content-length") {
                    content_length = value.trim().parse().unwrap();
                }
            }
        }
        let mut body = vec![0; content_length];
        reader.read_exact(&mut body).unwrap();
        before_response(body);
        write!(
            reader.get_mut(),
            "HTTP/1.1 {} Stub\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            status
        )
        .unwrap();
    });
    port
}

// Creates an empty auth control file, as openvpn does before invoking the auth script
fn create_auth_control_file(name: &str) -> PathBuf {
    let path = std::env::temp_dir().join(format!("auth-test-{}-{}", std::process::id(), name));
    std::fs::write(&path, "").unwrap();
    path
}

fn run_auth(port: u16, auth_control_file: &Path) {
    run_auth_as(port, auth_control_file, "uuid", "api-key");
}

fn run_auth_as(port: u16, auth_control_file: &Path, username: &str, password: &str) {
    let status = Command::new(env!("CARGO_BIN_EXE_auth"))
        .arg(port.to_string())
        .env("username", username)
        .env("password", password)
        .env("auth_control_file", auth_control_file)
        .status()
        .unwrap();
    assert!(status.success());
}

#[test]
fn authorizes_on_success() {
    let auth_control_file = create_auth_control_file("success");
    run_auth(stub_api(200, |_| {}), &auth_control_file);
    assert_eq!(std::fs::read_to_string(&auth_control_file).unwrap(), "1");
    std::fs::remove_file(&auth_control_file).unwrap();
}

#[test]
fn rejects_on_failure() {
    let auth_control_file = create_auth_control_file("failure");
    run_auth(stub_api(401, |_| {}), &auth_control_file);
    assert_eq!(std::fs::read_to_string(&auth_control_file).unwrap(), "0");
    std::fs::remove_file(&auth_control_file).unwrap();
}

#[test]
fn does_not_recreate_deleted_auth_control_file() {
    // openvpn deletes the auth control file when the client disconnects, eg because the client gave
    // up waiting for a response delayed by `DELAY_ON_AUTH_FAIL`
    let auth_control_file = create_auth_control_file("deleted");
    let to_delete = auth_control_file.clone();
    run_auth(
        stub_api(401, move |_| std::fs::remove_file(to_delete).unwrap()),
        &auth_control_file,
    );
    assert!(!auth_control_file.exists());
}

#[test]
fn escapes_credentials_in_request_body() {
    // The credentials come from the client so must not be able to add or override fields
    let auth_control_file = create_auth_control_file("escaping");
    let (body_tx, body_rx) = mpsc::channel();
    run_auth_as(
        stub_api(200, move |body| body_tx.send(body).unwrap()),
        &auth_control_file,
        "uuid\",\"username\":\"other",
        "api\\key\x01",
    );
    assert_eq!(
        String::from_utf8(body_rx.recv().unwrap()).unwrap(),
        r#"{"username":"uuid\",\"username\":\"other","password":"api\\key\u0001"}"#
    );
    std::fs::remove_file(&auth_control_file).unwrap();
}

#[test]
fn rejects_when_api_is_unreachable() {
    let auth_control_file = create_auth_control_file("unreachable");
    // Bind then drop a listener to get a port that nothing listens on
    let port = TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port();
    run_auth(port, &auth_control_file);
    assert_eq!(std::fs::read_to_string(&auth_control_file).unwrap(), "0");
    std::fs::remove_file(&auth_control_file).unwrap();
}
