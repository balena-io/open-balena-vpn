/*
    Copyright (C) 2022 Balena Ltd.

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

use std::io::{Read, Write};
use std::net::TcpStream;

fn write_auth_control_file(auth_control_file: &str, value: &str) {
    // We must not create the file as openvpn deletes it when the client disconnects, which can
    // happen before we respond (eg the client gives up waiting due to `DELAY_ON_AUTH_FAIL`), and
    // recreating it would leave a stray file behind for every such connection attempt
    match std::fs::OpenOptions::new()
        .write(true)
        .truncate(true)
        .open(auth_control_file)
    {
        Ok(mut file) => file.write_all(value.as_bytes()).unwrap(),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
        Err(err) => panic!("{}", err),
    }
}

// The username and password come from the client, so they must be escaped to stop them adding
// or overriding fields in the request body
fn push_json_string(out: &mut String, value: &str) {
    out.push('"');
    for c in value.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            c if c < ' ' => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
}

// Returns whether the api accepted the credentials, ie responded with a 2xx status.
//
// This speaks just enough HTTP/1.1 to make the request rather than using an HTTP client crate:
// openvpn can have a potentially large number of these processes waiting on responses delayed by
// `DELAY_ON_AUTH_FAIL`, and an HTTP client's buffers were most of the memory each one used
fn authenticate(vpn_api_port: &str, username: &str, password: &str) -> std::io::Result<bool> {
    let mut body = String::from("{\"username\":");
    push_json_string(&mut body, username);
    body.push_str(",\"password\":");
    push_json_string(&mut body, password);
    body.push('}');

    let mut stream = TcpStream::connect(format!("127.0.0.1:{}", vpn_api_port))?;
    stream.write_all(
        format!(
            "POST /api/v1/auth/ HTTP/1.1\r\n\
             Host: 127.0.0.1:{}\r\n\
             Content-Type: application/json\r\n\
             Content-Length: {}\r\n\
             Connection: close\r\n\
             \r\n\
             {}",
            vpn_api_port,
            body.len(),
            body
        )
        .as_bytes(),
    )?;

    // Only the status code matters, eg `HTTP/1.1 200 OK`
    let mut status_line = [0; 12];
    stream.read_exact(&mut status_line)?;
    Ok(status_line.starts_with(b"HTTP/1.") && status_line[8] == b' ' && status_line[9] == b'2')
}

fn main() {
    let username = std::env::var("username").unwrap();
    let password = std::env::var("password").unwrap();
    let auth_control_file = std::env::var("auth_control_file").unwrap();
    let vpn_api_port = std::env::args().nth(1).unwrap();

    if authenticate(&vpn_api_port, &username, &password).unwrap_or(false) {
        // Writing 1 authorizes login.
        write_auth_control_file(&auth_control_file, "1");
    } else {
        // Writing 0 rejects login.
        write_auth_control_file(&auth_control_file, "0");
    }
}
