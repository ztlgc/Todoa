// @vitest-environment jsdom
import {describe,it,expect,vi,afterEach} from "vitest";
import {act,render,screen,fireEvent,waitFor,cleanup} from "@testing-library/react";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {TaskReminders} from "./TaskReminders";
import {invoke} from "@tauri-apps/api/core";
import type {Task} from "@/domain/task";
import {toLocalInput} from "@/domain/taskDates";
vi.mock("@tauri-apps/api/core",()=>({invoke:vi.fn(async()=>"ready")}));
const api=vi.hoisted(()=>({list:vi.fn(),create:vi.fn(),edit:vi.fn(),delete:vi.fn()}));
vi.mock("@/data/repositories/ReminderRepository",async(importOriginal)=>({...await importOriginal<typeof import("@/data/repositories/ReminderRepository")>(),reminderRepository:api}));
afterEach(()=>{cleanup();vi.clearAllMocks();});
const task={id:1,title:"Test",status:"todo"} as Task;
function mount(value=task,onRegisterDraftSave?:(save:(()=>Promise<boolean>)|null)=>void){return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><TaskReminders task={value} disabled={false} onRegisterDraftSave={onRegisterDraftSave}/></QueryClientProvider>);}
describe("TaskReminders",()=>{
  it("saves a valid reminder draft when detail auto-save requests it",async()=>{
    api.list.mockResolvedValue([]);api.create.mockResolvedValue(undefined);
    let save:(()=>Promise<boolean>)|null=null;
    mount(task,callback=>{save=callback;});

    const input=await screen.findByLabelText("新增提醒");
    const future=toLocalInput(new Date(Date.now()+86_400_000).toISOString()).slice(0,16);
    fireEvent.change(input,{target:{value:future}});
    await waitFor(()=>expect(save).not.toBeNull());
    await act(async()=>{expect(await save!()).toBe(true);});
    expect(api.create).toHaveBeenCalledOnce();
    expect((input as HTMLInputElement).value).toBe("");
  });
  it("shows API accepted notice, validates dates and preserves failed edit draft",async()=>{
    const future=new Date(Date.now()+86_400_000).toISOString();api.list.mockResolvedValue([{id:3,taskId:1,remindAt:future,triggeredAt:null}]);api.edit.mockRejectedValue("WRITE_FAILED");
    mount();expect(await screen.findByText(/API 接受不代表/)).toBeTruthy();
    fireEvent.click(await screen.findByRole("button",{name:"编辑提醒"}));const input=screen.getByLabelText("编辑提醒") as HTMLInputElement;expect(input.value).not.toBe("");
    fireEvent.click(screen.getByRole("button",{name:"保存提醒"}));await screen.findByText(/提醒保存失败/);expect(input.value).not.toBe("");
    fireEvent.change(input,{target:{value:"2000-01-01T00:00"}});fireEvent.click(screen.getByRole("button",{name:"保存提醒"}));await screen.findByText("请选择有效的未来时刻。");expect(api.edit).toHaveBeenCalledTimes(1);
  });
  it("shows notification denial without claiming accepted delivery",async()=>{
    vi.mocked(invoke).mockResolvedValueOnce("NOTIFICATION_DENIED");api.list.mockResolvedValue([]);
    mount();await screen.findByText("系统通知已关闭，请在 Windows 设置中允许通知。");expect(screen.queryByText(/已接入系统通知/)).toBeNull();
  });
  it("shows unknown availability without claiming Granted or displayed",async()=>{
    vi.mocked(invoke).mockResolvedValueOnce("notification-setting-unknown");api.list.mockResolvedValue([]);
    mount();await screen.findByText(/系统通知设置暂无法确认/);expect(screen.queryByText(/已接入系统通知/)).toBeNull();
  });
  it("completed task hides creation and triggered reminder editing; deletion remains",async()=>{
    api.list.mockResolvedValue([{id:4,taskId:1,remindAt:new Date().toISOString(),triggeredAt:new Date().toISOString()}]);api.delete.mockResolvedValue(undefined);
    mount({...task,status:"completed"});fireEvent.click(await screen.findByRole("button",{name:"删除提醒"}));await waitFor(()=>expect(api.delete).toHaveBeenCalledWith(4));expect(screen.queryByRole("button",{name:"编辑提醒"})).toBeNull();expect(screen.queryByRole("button",{name:"保存提醒"})).toBeNull();
  });
});
