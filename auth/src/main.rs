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

extern crate ureq;

use std::io::Write;

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

fn main() {
    let username = std::env::var("username").unwrap();
    let password = std::env::var("password").unwrap();
    let auth_control_file = std::env::var("auth_control_file").unwrap();
    let auth_failed_reason_file = std::env::var("auth_failed_reason_file").unwrap();
    let vpn_api_port = std::env::args().nth(1).unwrap();

    match ureq::post(&format!("http://127.0.0.1:{}/api/v1/auth/", vpn_api_port))
        .header("Content-type", "application/json")
        .send(&format!(
            "{{\"username\":\"{}\",\"password\":\"{}\"}}",
            username, password
        )) {
        Ok(_) => {
            // Writing 1 authorizes login.
            write_auth_control_file(&auth_control_file, "1");
        }
        Err(_) => {
            // Mark as a temp failure so that we can specify a backoff rather than have clients forever retry at their own rate
            std::fs::write(auth_failed_reason_file, "TEMP[backoff 60]").unwrap();
            // Writing 0 rejects login.
            write_auth_control_file(&auth_control_file, "0");
        }
    }
}
