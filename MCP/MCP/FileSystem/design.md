设计思路：
让ai自己去阅读磁盘，目录，文件
我可以给一些resource关于一些应用程序的安装目录结构


目前：
Tools：
1. 列出磁盘列表数组
2. 根据路径得到目录下文件和目录信息


工具	功能	实现要点（PowerShell）
get_installed_apps	已安装应用列表	读取注册表 HKLM/HKCU/...\Uninstall\*，返回名称、版本、发布者、安装位置、EstimatedSize（KB）
get_directory_size	目录真实占用	Get-ChildItem -Recurse | Measure-Object Length -Sum，跳过符号链接/系统重解析点避免死循环，返回总大小和子目录 Top-N
get_drive_space	磁盘容量/剩余	Get-PSDrive 或 Get-CimInstance Win32_LogicalDisk
get_process_list	运行中进程	Get-Process，扩展当前 get_app_status 只查单个应用的能力