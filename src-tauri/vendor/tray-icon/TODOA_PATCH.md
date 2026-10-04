# Windows tray presence, upstream 0.25.1

The locked backend considers only S_OK from Shell_NotifyIconGetRect present.
On the tested Windows 10 Shell, a registered icon in collapsed overflow returns
S_FALSE (1) with valid chevron bounds; expanding overflow returns S_OK and the
same application's actual menu is usable. Rejecting S_FALSE removes a working
tray and prevents background autostart. Accept a successful HRESULT with
positive bounds; negative HRESULT and empty bounds remain unavailable.
Only this check differs; upstream source and licenses are preserved.
