use std::path::{Path, PathBuf};

// Windows API принимает verbatim-пути, но загрузчик главного файла Node
// может интерпретировать их как относительный путь диска (lstat 'D:').
fn plain_windows_path(s: &str) -> String {
    if let Some(tail) = s.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{}", tail);
    }
    if let Some(tail) = s.strip_prefix(r"\\?\") {
        let b = tail.as_bytes();
        if b.len() >= 3 && b[0].is_ascii_alphabetic() && b[1] == b':' && b[2] == b'\\' {
            return tail.to_string();
        }
    }
    s.to_string()
}

pub fn for_node(path: &Path) -> PathBuf {
    if cfg!(windows) { PathBuf::from(plain_windows_path(&path.to_string_lossy())) }
    else { path.to_path_buf() }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn windows_paths() {
        assert_eq!(plain_windows_path(r"\\?\D:\стенд с пробелом\server\launch.mjs"), r"D:\стенд с пробелом\server\launch.mjs");
        assert_eq!(plain_windows_path(r"\\?\UNC\server\share\launch.mjs"), r"\\server\share\launch.mjs");
        assert_eq!(plain_windows_path(r"D:\stand\launch.mjs"), r"D:\stand\launch.mjs");
        assert_eq!(plain_windows_path("/tmp/stand/launch.mjs"), "/tmp/stand/launch.mjs");
        let root = plain_windows_path(r"\\?\D:\k\output\Стенд");
        let theatre = format!("{root}/data/packages/sim/data/theatres/oder-berlin-1945.json");
        assert_eq!(theatre, r"D:\k\output\Стенд/data/packages/sim/data/theatres/oder-berlin-1945.json");
        assert!(!theatre.starts_with(r"\\?\"));
    }
}
