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

fn main() {
    let username = std::env::var("username").unwrap();
    let password = std::env::var("password").unwrap();
    let auth_control_file = std::env::var("auth_control_file").unwrap();
    let vpn_api_port = std::env::args().nth(1).unwrap();

    match ureq::post(&format!("http://127.0.0.1:{}/api/v1/auth/", vpn_api_port))
        .set("Content-type", "application/json")
        .send_string(&format!(
            "{{\"username\":\"{}\",\"password\":\"{}\"}}",
            username, password
        )) {
        Ok(_) => {
            // Writing 1 authorizes login.
            std::fs::write(auth_control_file, "1").unwrap();
        }
        Err(_) => {
            // Writing 0 rejects login.
            std::fs::write(auth_control_file, "0").unwrap();
        }
    }
}
